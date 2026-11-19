//! How long frames take from capture to the network, logged every few seconds. This is
//! the host's share of the latency guests see.

use std::time::{Duration, Instant};

use tracing::info;

const REPORT_EVERY: Duration = Duration::from_secs(10);

pub struct FrameDelays {
    samples: Vec<Duration>,
    since: Instant,
}

impl Default for FrameDelays {
    fn default() -> Self {
        Self {
            samples: Vec::new(),
            since: Instant::now(),
        }
    }
}

impl FrameDelays {
    pub fn record(&mut self, delay: Duration) {
        self.samples.push(delay);
        if self.since.elapsed() < REPORT_EVERY {
            return;
        }
        self.samples.sort_unstable();
        let at = |q: f64| self.samples[((self.samples.len() - 1) as f64 * q).round() as usize];
        let fps = self.samples.len() as f64 / self.since.elapsed().as_secs_f64();
        info!(
            fps = format!("{fps:.0}"),
            median_ms = format!("{:.1}", at(0.5).as_secs_f64() * 1000.0),
            p95_ms = format!("{:.1}", at(0.95).as_secs_f64() * 1000.0),
            "capture to network"
        );
        self.samples.clear();
        self.since = Instant::now();
    }
}
