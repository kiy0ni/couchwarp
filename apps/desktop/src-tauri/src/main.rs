//! Couchwarp for Mac and Windows. The window shows the Couchwarp site, the same pages as in
//! a browser, so both stay in step with one deployment. The app adds what a browser cannot
//! do: share a game window with guests, and sign in through the system browser.

// No console window behind the app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod awake;
mod bubble;
mod commands;
mod hosting;

use tauri::utils::config::FrontendDist;
use tauri::webview::{Color, WebviewWindowBuilder};
use tauri::{Manager, RunEvent, Url, WebviewUrl};
use tauri_plugin_opener::OpenerExt;
use tracing_subscriber::EnvFilter;

/// The page background, so the window never flashes white while the site loads.
const PAPER: Color = Color(17, 15, 13, 255);

/// The Couchwarp site this app shows and hosts for: the dev server while developing.
pub struct Site(pub Url);

impl Site {
    /// The address guests open, without a trailing slash.
    pub fn address(&self) -> String {
        self.0.as_str().trim_end_matches('/').to_owned()
    }
}

fn site(config: &tauri::Config) -> Url {
    let configured = if tauri::is_dev() {
        config.build.dev_url.clone()
    } else {
        match &config.build.frontend_dist {
            Some(FrontendDist::Url(url)) => Some(url.clone()),
            _ => None,
        }
    };
    configured.expect("tauri.conf.json names the site in build.devUrl and build.frontendDist")
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .with_target(false)
        .init();
    couchwarp_host::platform::init();

    let context = tauri::generate_context!();
    let site_url = site(context.config());
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Site(site_url.clone()))
        .manage(hosting::Hosting::default())
        .invoke_handler(tauri::generate_handler![
            commands::list_windows,
            commands::window_preview,
            commands::hosting_state,
            commands::start_hosting,
            commands::stop_hosting,
            commands::saved_session,
            commands::sign_in,
            commands::sign_out,
            commands::input_allowed,
            commands::open_privacy_settings,
            commands::set_bubble_open,
            commands::show_main_window,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let origin = site_url.origin();
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(site_url))
                .title("Couchwarp")
                .inner_size(1280.0, 800.0)
                .min_inner_size(960.0, 620.0)
                .background_color(PAPER)
                // Links to other sites open in the browser; this window stays on Couchwarp.
                .on_navigation(move |url| {
                    if url.origin() == origin {
                        return true;
                    }
                    if matches!(url.scheme(), "http" | "https")
                        && let Err(error) = handle.opener().open_url(url.as_str(), None::<&str>)
                    {
                        tracing::warn!(%error, "could not open the link in the browser");
                    }
                    false
                });
            // On a Mac the page draws under the title bar, around the window buttons.
            #[cfg(target_os = "macos")]
            let builder = builder
                .title_bar_style(tauri::TitleBarStyle::Overlay)
                .hidden_title(true);
            builder.build()?;
            Ok(())
        })
        .build(context)
        .expect("the app could not start")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                app.state::<hosting::Hosting>().stop_and_wait();
            }
        });
}
