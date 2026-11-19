//! The game's sound on Windows: WASAPI process loopback captures the game process and
//! every process it started, so sound played by a helper process is included too.

use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::JoinHandle;

use anyhow::{Context, Result, anyhow};
use tokio::sync::mpsc;
use tracing::warn;
use wasapi::{AudioClient, Direction, SampleType, StreamMode, WaveFormat, initialize_mta};

use crate::audio::{AudioEncoder, AudioPacket, SAMPLE_RATE};

/// How long a read waits for sound before checking whether to stop.
const WAIT_MS: u32 = 100;

pub struct SoundCapture {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl SoundCapture {
    pub fn start(pid: u32, sound: mpsc::Sender<AudioPacket>) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = stop.clone();
        let thread = std::thread::spawn(move || {
            if let Err(error) = capture(pid, &sound, &stopping) {
                warn!("{error:#}; the game plays without sound");
            }
        });
        Self {
            stop,
            thread: Some(thread),
        }
    }
}

impl Drop for SoundCapture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn capture(pid: u32, sound: &mpsc::Sender<AudioPacket>, stop: &AtomicBool) -> Result<()> {
    initialize_mta()
        .ok()
        .map_err(|error| anyhow!("COM setup failed: {error}"))?;
    let format = WaveFormat::new(32, 32, &SampleType::Float, SAMPLE_RATE as usize, 2, None);
    let mut client = AudioClient::new_application_loopback_client(pid, true)
        .context("cannot listen to the game's sound")?;
    let mode = StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns: 0,
    };
    client
        .initialize_client(&format, Direction::Capture, mode, None)
        .context("the sound format was refused")?;
    let ready = client.set_get_eventhandle().context("no sound event")?;
    let reader = client.get_audiocaptureclient().context("no sound reader")?;
    client.start_stream().context("sound did not start")?;

    let mut encoder = AudioEncoder::new()?;
    let mut bytes = VecDeque::new();
    while !stop.load(Ordering::Acquire) {
        if ready.wait_for_event(WAIT_MS).is_err() {
            continue;
        }
        reader
            .read_from_device_to_deque(&mut bytes)
            .context("sound read failed")?;
        let samples: Vec<f32> = bytes
            .drain(..bytes.len() - bytes.len() % 4)
            .collect::<Vec<u8>>()
            .as_chunks::<4>()
            .0
            .iter()
            .map(|sample| f32::from_le_bytes(*sample))
            .collect();
        for packet in encoder.push(&samples)? {
            // A full queue means the network side is behind; late sound is useless.
            let _ = sound.try_send(packet);
        }
    }
    client.stop_stream().context("sound did not stop")?;
    Ok(())
}
