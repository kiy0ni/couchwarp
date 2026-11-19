//! Picks the video bitrate from how the stream arrives at each guest. Every second a
//! guest reports its packet loss and picture latency; a struggling connection gets less,
//! a clean one gets more, step by step. One encoder feeds every guest, so the weakest
//! connection decides: a picture a little softer for all beats a frozen one for one.
//!
//! The reports come from the guests' own measures, not from pacing packets on the host:
//! pacing would queue frames and add the very latency it tries to avoid.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use couchwarp_protocol::signal::GuestId;

/// Below this a game turns to mush; better to let the picture lag a little.
pub const MIN_BITRATE: u32 = 1_500_000;
/// More loss than this (2 %) means the connection cannot carry the stream.
const LOSS_LIMIT_PERMILLE: u16 = 20;
/// Picture latency this far above the best seen for the guest means packets queue up.
const LATENCY_RISE_MS: u32 = 40;
/// A cut takes about a second to show in the reports: no second cut before that.
const CUT: f64 = 0.8;
const CUT_EVERY: Duration = Duration::from_secs(1);
/// After this long without trouble, the guest gets a little more.
const RAISE: f64 = 1.1;
const CLEAN_FOR: Duration = Duration::from_secs(4);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QualityReport {
    pub loss_permille: u16,
    pub latency_ms: Option<u32>,
}

struct Link {
    allowance: u32,
    best_latency: Option<u32>,
    clean_since: Instant,
    cut_at: Option<Instant>,
}

pub struct BitrateController {
    max: u32,
    current: u32,
    links: HashMap<GuestId, Link>,
}

impl BitrateController {
    /// `max` is the bitrate asked for on the command line, the most any guest gets.
    pub fn new(max: u32) -> Self {
        Self {
            max,
            current: max,
            links: HashMap::new(),
        }
    }

    /// One second of `guest`'s stream. Returns the new video bitrate when it changes.
    pub fn report(&mut self, guest: GuestId, report: QualityReport, now: Instant) -> Option<u32> {
        let max = self.max;
        let link = self.links.entry(guest).or_insert(Link {
            allowance: max,
            best_latency: None,
            clean_since: now,
            cut_at: None,
        });
        if let Some(latency) = report.latency_ms {
            link.best_latency = Some(link.best_latency.map_or(latency, |best| best.min(latency)));
        }
        let queuing = report
            .latency_ms
            .zip(link.best_latency)
            .is_some_and(|(latency, best)| latency > best + LATENCY_RISE_MS);
        if report.loss_permille > LOSS_LIMIT_PERMILLE || queuing {
            link.clean_since = now;
            if link
                .cut_at
                .is_none_or(|at| now.duration_since(at) >= CUT_EVERY)
            {
                link.allowance = scale(link.allowance, CUT).max(MIN_BITRATE.min(max));
                link.cut_at = Some(now);
            }
        } else if now.duration_since(link.clean_since) >= CLEAN_FOR && link.allowance < max {
            link.allowance = scale(link.allowance, RAISE).min(max);
            link.clean_since = now;
        }
        self.retarget()
    }

    /// The guest is gone; the others may get a better picture.
    pub fn remove(&mut self, guest: GuestId) -> Option<u32> {
        self.links.remove(&guest)?;
        self.retarget()
    }

    fn retarget(&mut self) -> Option<u32> {
        let wanted = self
            .links
            .values()
            .map(|link| link.allowance)
            .min()
            .unwrap_or(self.max);
        (wanted != self.current).then(|| {
            self.current = wanted;
            wanted
        })
    }
}

fn scale(bits: u32, factor: f64) -> u32 {
    (f64::from(bits) * factor) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLEAN: QualityReport = QualityReport {
        loss_permille: 0,
        latency_ms: Some(30),
    };

    fn lossy(permille: u16) -> QualityReport {
        QualityReport {
            loss_permille: permille,
            latency_ms: Some(30),
        }
    }

    #[test]
    fn loss_cuts_at_once_but_not_twice_in_a_second() {
        let start = Instant::now();
        let mut bitrate = BitrateController::new(10_000_000);
        assert_eq!(bitrate.report(1, CLEAN, start), None);
        assert_eq!(bitrate.report(1, lossy(50), start), Some(8_000_000));
        let soon = start + Duration::from_millis(500);
        assert_eq!(bitrate.report(1, lossy(50), soon), None);
        let later = start + Duration::from_secs(1);
        assert_eq!(bitrate.report(1, lossy(50), later), Some(6_400_000));
    }

    #[test]
    fn rising_latency_counts_as_trouble() {
        let start = Instant::now();
        let mut bitrate = BitrateController::new(10_000_000);
        bitrate.report(1, CLEAN, start);
        let slow = QualityReport {
            loss_permille: 0,
            latency_ms: Some(90),
        };
        assert_eq!(bitrate.report(1, slow, start), Some(8_000_000));
    }

    #[test]
    fn a_clean_connection_climbs_back_slowly() {
        let start = Instant::now();
        let mut bitrate = BitrateController::new(10_000_000);
        bitrate.report(1, lossy(50), start);
        assert_eq!(
            bitrate.report(1, CLEAN, start + Duration::from_secs(3)),
            None
        );
        assert_eq!(
            bitrate.report(1, CLEAN, start + Duration::from_secs(4)),
            Some(8_800_000)
        );
    }

    #[test]
    fn the_weakest_guest_decides_and_frees_the_others_when_leaving() {
        let start = Instant::now();
        let mut bitrate = BitrateController::new(10_000_000);
        bitrate.report(1, CLEAN, start);
        assert_eq!(bitrate.report(2, lossy(80), start), Some(8_000_000));
        assert_eq!(bitrate.remove(2), Some(10_000_000));
        assert_eq!(bitrate.remove(2), None);
    }

    #[test]
    fn cuts_stop_at_the_floor() {
        let mut now = Instant::now();
        let mut bitrate = BitrateController::new(3_000_000);
        for _ in 0..10 {
            bitrate.report(1, lossy(100), now);
            now += CUT_EVERY;
        }
        assert_eq!(bitrate.current, MIN_BITRATE);
    }
}
