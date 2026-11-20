//! The game's sound on Linux, and only the game's: `parec --monitor-stream` records one
//! program's stream, on PulseAudio and on PipeWire (through `pipewire-pulse`). The host
//! keeps hearing the game as usual.
//!
//! A game may open its stream late, or close and reopen it; the stream is looked for again
//! until the session ends. Without `pactl` and `parec` (package `pulseaudio-utils`), the
//! game plays without sound for guests.

use std::io::{ErrorKind, Read};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use anyhow::{Context, Result};
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::audio::{AudioEncoder, AudioPacket, SAMPLE_RATE};
use crate::pulse::{family, parent_in_stat, sink_inputs};

/// How often to look for the game's stream while it has none.
const LOOK_EVERY: Duration = Duration::from_secs(2);
/// 10 ms of stereo 32-bit samples.
const CHUNK: usize = SAMPLE_RATE as usize / 100 * 2 * 4;

pub struct SoundCapture {
    stop: Arc<AtomicBool>,
    recorder: Arc<Mutex<Option<Child>>>,
    thread: Option<JoinHandle<()>>,
}

impl SoundCapture {
    pub fn start(pid: i32, sound: mpsc::Sender<AudioPacket>) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let recorder = Arc::new(Mutex::new(None));
        let (stopping, recording) = (stop.clone(), recorder.clone());
        let thread = std::thread::Builder::new()
            .name("sound".to_owned())
            .spawn(move || {
                if let Err(error) = run(pid, &sound, &stopping, &recording) {
                    warn!("{error:#}; the game plays without sound");
                }
            })
            .map_err(|error| warn!(%error, "no sound thread; the game plays without sound"))
            .ok();
        Self {
            stop,
            recorder,
            thread,
        }
    }
}

impl Drop for SoundCapture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        // Ending the recorder ends the read the thread is waiting on.
        if let Some(mut child) = self.recorder.lock().ok().and_then(|mut slot| slot.take()) {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn run(
    pid: i32,
    sound: &mpsc::Sender<AudioPacket>,
    stop: &AtomicBool,
    recorder: &Mutex<Option<Child>>,
) -> Result<()> {
    let mut encoder = AudioEncoder::new()?;
    let mut announced = false;
    while !stop.load(Ordering::Acquire) {
        let Some(stream) = game_stream(pid)? else {
            rest(stop);
            continue;
        };
        if !announced {
            info!(stream, "recording the game's sound");
            announced = true;
        }
        let mut child = Command::new("parec")
            .args([
                &format!("--monitor-stream={stream}"),
                "--format=float32le",
                &format!("--rate={SAMPLE_RATE}"),
                "--channels=2",
                "--latency-msec=10",
                "--raw",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .context("cannot start parec (install pulseaudio-utils)")?;
        let mut output = child.stdout.take().context("parec gave no output")?;
        *recorder.lock().expect("never poisoned") = Some(child);
        if stop.load(Ordering::Acquire) {
            break;
        }
        forward(&mut output, &mut encoder, sound)?;
        // The stream ended (the game closed it), or the session is stopping.
        if let Some(mut child) = recorder.lock().expect("never poisoned").take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    Ok(())
}

/// Waits before the next look, in short steps so a stop is never kept waiting.
fn rest(stop: &AtomicBool) {
    const STEP: Duration = Duration::from_millis(100);
    let mut waited = Duration::ZERO;
    while waited < LOOK_EVERY && !stop.load(Ordering::Acquire) {
        std::thread::sleep(STEP);
        waited += STEP;
    }
}

/// Encodes what the recorder writes until it stops.
fn forward(
    output: &mut impl Read,
    encoder: &mut AudioEncoder,
    sound: &mpsc::Sender<AudioPacket>,
) -> Result<()> {
    let mut bytes = vec![0u8; CHUNK];
    let mut filled = 0;
    loop {
        match output.read(&mut bytes[filled..]) {
            Ok(0) => return Ok(()),
            Ok(read) => filled += read,
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) => return Err(error).context("sound read failed"),
        }
        let whole = filled - filled % 4;
        let samples: Vec<f32> = bytes[..whole]
            .as_chunks::<4>()
            .0
            .iter()
            .map(|sample| f32::from_le_bytes(*sample))
            .collect();
        bytes.copy_within(whole..filled, 0);
        filled -= whole;
        for packet in encoder.push(&samples)? {
            // A full queue means the network side is behind; late sound is useless.
            let _ = sound.try_send(packet);
        }
    }
}

/// The sound stream of the game or of a process it started, if one is playing.
fn game_stream(pid: i32) -> Result<Option<u32>> {
    let listing = Command::new("pactl")
        .args(["list", "sink-inputs"])
        // The headings are translated otherwise.
        .env("LC_ALL", "C")
        .stderr(Stdio::null())
        .output()
        .context("cannot list sound streams (install pulseaudio-utils)")?;
    let streams = sink_inputs(&String::from_utf8_lossy(&listing.stdout));
    if streams.is_empty() {
        return Ok(None);
    }
    let game = family(pid, &parents());
    Ok(streams
        .into_iter()
        .find(|(_, player)| game.contains(player))
        .map(|(stream, _)| stream))
}

/// Every process and its parent, from `/proc`.
fn parents() -> Vec<(i32, i32)> {
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    entries
        .filter_map(|entry| {
            let pid: i32 = entry.ok()?.file_name().to_str()?.parse().ok()?;
            let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
            Some((pid, parent_in_stat(&stat)?))
        })
        .collect()
}
