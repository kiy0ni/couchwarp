//! How long frames take from capture to the network: the host's share of the latency
//! guests see.

use std::time::{Duration, Instant};

const REPORT_EVERY: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DelayReport {
    pub fps: f64,
    pub median_ms: f64,
    pub p95_ms: f64,
}

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
    /// Adds one frame. Every two seconds, returns what the frames since the last report took.
    pub fn record(&mut self, delay: Duration) -> Option<DelayReport> {
        self.samples.push(delay);
        let elapsed = self.since.elapsed();
        if elapsed < REPORT_EVERY {
            return None;
        }
        self.samples.sort_unstable();
        let at = |q: f64| {
            let sample = self.samples[((self.samples.len() - 1) as f64 * q).round() as usize];
            sample.as_secs_f64() * 1000.0
        };
        let report = DelayReport {
            fps: self.samples.len() as f64 / elapsed.as_secs_f64(),
            median_ms: at(0.5),
            p95_ms: at(0.95),
        };
        self.samples.clear();
        self.since = Instant::now();
        Some(report)
    }
}
