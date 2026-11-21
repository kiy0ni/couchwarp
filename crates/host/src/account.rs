//! The host app's account: signing in through the browser, and the session token kept in
//! the user's config folder, one per Couchwarp site. A signed-in host can list its games
//! publicly, and guests see its name.

use std::collections::BTreeMap;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::Command;
use std::sync::mpsc;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use clap::ValueEnum;
use tracing::warn;

/// How long the browser has to come back from the sign-in page.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum Provider {
    Discord,
    Google,
}

impl Provider {
    fn id(self) -> &'static str {
        match self {
            Self::Discord => "discord",
            Self::Google => "google",
        }
    }
}

/// Opens the sign-in page in the browser, waits for it to come back to a page served here
/// on loopback, and keeps the token it carries. `show_link` gets the page's address, for
/// when no browser opens. Returns the account's name.
pub fn sign_in(server: &str, provider: Provider, show_link: impl FnOnce(&str)) -> Result<String> {
    let listener = TcpListener::bind("127.0.0.1:0").context("cannot open a local port")?;
    // A random path, so only the sign-in that this run started is accepted.
    let nonce = format!("{:016x}", fastrand::u64(..));
    let return_to = format!("http://127.0.0.1:{}/{nonce}", listener.local_addr()?.port());
    let start = format!(
        "{}/api/auth/{}/start?client=host&return_to={}",
        site(server),
        provider.id(),
        encode(&return_to)
    );

    show_link(&start);
    if let Err(error) = open_browser(&start) {
        warn!(%error, "could not open the browser");
    }

    let (found_tx, found) = mpsc::channel();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            if let Some(outcome) = answer(stream, &nonce) {
                let _ = found_tx.send(outcome);
                return;
            }
        }
    });
    let outcome = found
        .recv_timeout(SIGN_IN_TIMEOUT)
        .context("no answer from the browser within five minutes")?;
    let token = outcome.map_err(|code| anyhow::anyhow!("sign-in failed: {code}"))?;

    let name = display_name(server, &token)?.context("the new session was refused")?;
    let mut tokens = load_tokens();
    tokens.insert(site(server).to_owned(), token);
    save_tokens(&tokens)?;
    Ok(name)
}

/// Keeps a session obtained another way, such as a password typed in the desktop app.
pub fn remember(server: &str, token: &str) -> Result<()> {
    let mut tokens = load_tokens();
    tokens.insert(site(server).to_owned(), token.to_owned());
    save_tokens(&tokens)
}

/// Ends the session on the server and forgets it here.
pub fn sign_out(server: &str) -> Result<bool> {
    let mut tokens = load_tokens();
    let Some(token) = tokens.remove(site(server)) else {
        return Ok(false);
    };
    if let Err(error) = ureq::post(format!("{}/api/auth/logout", site(server)))
        .header("Authorization", format!("Bearer {token}"))
        .send_empty()
    {
        warn!(%error, "the server did not hear the sign-out; the session expires on its own");
    }
    save_tokens(&tokens)?;
    Ok(true)
}

/// The token kept for `server`, if any.
pub fn token(server: &str) -> Option<String> {
    load_tokens().remove(site(server))
}

/// The account name behind `token`, or None when the server no longer accepts it.
pub fn display_name(server: &str, token: &str) -> Result<Option<String>> {
    let response = ureq::get(format!("{}/api/me", site(server)))
        .header("Authorization", format!("Bearer {token}"))
        .config()
        .http_status_as_error(false)
        .build()
        .call()
        .with_context(|| format!("cannot reach {server}"))?;
    if response.status() == 401 {
        return Ok(None);
    }
    if !response.status().is_success() {
        bail!("{server} answered HTTP {}", response.status());
    }
    let me: serde_json::Value = serde_json::from_str(&response.into_body().read_to_string()?)?;
    Ok(Some(
        me["displayName"].as_str().unwrap_or_default().to_owned(),
    ))
}

/// Forgets a token the server refused.
pub fn forget(server: &str) -> Result<()> {
    let mut tokens = load_tokens();
    if tokens.remove(site(server)).is_some() {
        save_tokens(&tokens)?;
    }
    Ok(())
}

/// Reads one request on the loopback port. Returns the token, or the error code the site
/// sent back, once the request is the one this sign-in is waiting for.
fn answer(stream: TcpStream, nonce: &str) -> Option<Result<String, String>> {
    let mut reader = BufReader::new(&stream);
    let mut request_line = String::new();
    reader.read_line(&mut request_line).ok()?;
    let target = request_line.split_whitespace().nth(1)?;
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let mine = path.trim_start_matches('/') == nonce;
    let outcome = mine.then(|| {
        let value = |key: &str| {
            query
                .split('&')
                .filter_map(|pair| pair.split_once('='))
                .find(|(name, _)| *name == key)
                .map(|(_, value)| decode(value))
        };
        match (value("token"), value("auth_error")) {
            (Some(token), _) if !token.is_empty() => Ok(token),
            (_, Some(code)) => Err(code),
            _ => Err("no-token".to_owned()),
        }
    });
    let body = match &outcome {
        Some(Ok(_)) => "Couchwarp is signed in. You can close this tab.",
        Some(Err(_)) => "Sign-in did not go through. Go back to Couchwarp.",
        None => "Nothing here.",
    };
    let status = if mine { "200 OK" } else { "404 Not Found" };
    let _ = write!(
        &stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    outcome
}

fn open_browser(url: &str) -> Result<()> {
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    // Not `cmd /C start`: cmd reads the `&` between query parameters as the end of the
    // command, and the browser got the address cut after its first parameter.
    #[cfg(windows)]
    let mut command = {
        let mut command = Command::new("rundll32.exe");
        command.arg("url.dll,FileProtocolHandler");
        command
    };
    #[cfg(not(any(target_os = "macos", windows)))]
    let mut command = Command::new("xdg-open");
    command.arg(url).spawn()?;
    Ok(())
}

fn site(server: &str) -> &str {
    server.trim_end_matches('/')
}

fn tokens_path() -> Option<PathBuf> {
    let env = |name| std::env::var_os(name).map(PathBuf::from);
    let folder = if cfg!(target_os = "macos") {
        env("HOME")?.join("Library/Application Support/Couchwarp")
    } else if cfg!(windows) {
        env("APPDATA")?.join("Couchwarp")
    } else {
        env("XDG_CONFIG_HOME")
            .or_else(|| env("HOME").map(|home| home.join(".config")))?
            .join("couchwarp")
    };
    Some(folder.join("sessions.json"))
}

/// Site address to session token. A missing or unreadable file means no session.
fn load_tokens() -> BTreeMap<String, String> {
    tokens_path()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_tokens(tokens: &BTreeMap<String, String>) -> Result<()> {
    let path = tokens_path().context("no home folder to keep the session in")?;
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder)?;
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    // The token opens the account: only this user may read it.
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options
        .open(&path)
        .with_context(|| format!("cannot write {}", path.display()))?;
    file.write_all(serde_json::to_string_pretty(tokens)?.as_bytes())?;
    Ok(())
}

/// Percent-encodes a query value.
fn encode(value: &str) -> String {
    value
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (byte as char).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect()
}

/// Percent-decodes a query value; `+` stands for a space.
fn decode(value: &str) -> String {
    let hex = |byte: Option<&u8>| {
        byte.and_then(|&b| (b as char).to_digit(16))
            .map(|d| d as u8)
    };
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => match (hex(bytes.get(i + 1)), hex(bytes.get(i + 2))) {
                (Some(high), Some(low)) => {
                    out.push(high * 16 + low);
                    i += 3;
                    continue;
                }
                _ => out.push(b'%'),
            },
            b'+' => out.push(b' '),
            byte => out.push(byte),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn query_values_survive_a_round_trip() {
        let value = "http://127.0.0.1:5000/abc?x=1&y=é";
        assert_eq!(decode(&encode(value)), value);
        assert_eq!(decode("a+b%2Fc"), "a b/c");
        assert_eq!(decode("100%"), "100%");
    }

    #[test]
    fn only_the_awaited_request_is_answered() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let send = |line: &'static str| {
            std::thread::spawn(move || {
                let mut client = TcpStream::connect(address).unwrap();
                write!(client, "{line}\r\nHost: x\r\n\r\n").unwrap();
            })
        };

        send("GET /favicon.ico HTTP/1.1");
        let (stream, _) = listener.accept().unwrap();
        assert_eq!(answer(stream, "n0nce"), None);

        send("GET /n0nce?token=abc%3D HTTP/1.1");
        let (stream, _) = listener.accept().unwrap();
        assert_eq!(answer(stream, "n0nce"), Some(Ok("abc=".to_owned())));

        send("GET /n0nce?auth_error=banned HTTP/1.1");
        let (stream, _) = listener.accept().unwrap();
        assert_eq!(answer(stream, "n0nce"), Some(Err("banned".to_owned())));
    }
}
