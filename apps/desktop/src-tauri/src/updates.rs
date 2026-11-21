//! Updates from the app's GitHub releases, read through the Couchwarp server (see
//! `services/edge/src/updates.ts`). The app looks shortly after it starts, then every few
//! hours, and tells the page when a version is waiting. The page shows a small button in its
//! top bar; one click downloads, installs and restarts.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::hosting::Hosting;

/// Long enough for the window to load first, so the look never slows the start.
const FIRST_LOOK: Duration = Duration::from_secs(10);
const LOOK_EVERY: Duration = Duration::from_secs(4 * 60 * 60);

/// The update found by the last look, kept until it is installed.
#[derive(Default)]
pub struct Updates(Mutex<Option<Update>>);

/// What the page shows about a waiting version.
#[derive(Clone, Serialize)]
pub struct Available {
    version: String,
    notes: Option<String>,
}

impl From<&Update> for Available {
    fn from(update: &Update) -> Self {
        Self {
            version: update.version.clone(),
            notes: update.body.clone(),
        }
    }
}

/// Where an install has got to, sent to the page as it goes.
#[derive(Clone, Serialize)]
#[serde(tag = "step", rename_all = "camelCase")]
pub enum Progress {
    Downloading { done: u64, total: Option<u64> },
    Installing,
}

impl Updates {
    pub fn available(&self) -> Option<Available> {
        self.0
            .lock()
            .expect("never poisoned")
            .as_ref()
            .map(Available::from)
    }

    fn keep(&self, update: Update) {
        *self.0.lock().expect("never poisoned") = Some(update);
    }

    fn waiting(&self) -> Option<Update> {
        self.0.lock().expect("never poisoned").clone()
    }
}

/// Looks for updates now and then, for as long as the app runs. A development build never
/// looks: its version is not a released one.
pub fn watch(app: AppHandle) {
    if tauri::is_dev() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_LOOK).await;
        loop {
            look(&app).await;
            tokio::time::sleep(LOOK_EVERY).await;
        }
    });
}

async fn look(app: &AppHandle) {
    match check(app).await {
        Ok(_) => {}
        // Offline, or no release yet: the next look will try again.
        Err(error) => tracing::info!(%error, "could not look for updates"),
    }
}

/// Looks for a newer version now. Returns it, or `None` when this one is the latest; the
/// page also hears of it through the `update` event, as with the looks made in the
/// background.
pub async fn check(app: &AppHandle) -> anyhow::Result<Option<Available>> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(None);
    };
    let available = Available::from(&update);
    tracing::info!(version = %available.version, "an update is available");
    app.state::<Updates>().keep(update);
    if let Err(error) = app.emit("update", available.clone()) {
        tracing::warn!(%error, "could not tell the page about the update");
    }
    Ok(Some(available))
}

/// Downloads and installs the waiting update, then restarts into it. A game being hosted
/// ends first, so guests see the room close rather than freeze.
pub async fn install(app: &AppHandle, progress: Channel<Progress>) -> anyhow::Result<()> {
    let update = app
        .state::<Updates>()
        .waiting()
        .ok_or_else(|| anyhow::anyhow!("no update is waiting"))?;
    let mut done = 0;
    let bytes = update
        .download(
            |chunk, total| {
                done += chunk as u64;
                // The page only redraws; a lost message is made up by the next one.
                let _ = progress.send(Progress::Downloading { done, total });
            },
            || {},
        )
        .await?;
    let _ = progress.send(Progress::Installing);
    let host = app.clone();
    tauri::async_runtime::spawn_blocking(move || host.state::<Hosting>().stop_and_wait()).await?;
    // On Windows the installer takes over from here and closes the app itself.
    update.install(bytes)?;
    app.restart();
}
