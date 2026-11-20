//! Finding the game's sound on Linux. PulseAudio, and PipeWire through its PulseAudio
//! layer, list every program's sound stream as a "sink input" with the process that plays
//! it. The game's streams are those of its process or of any process it started.

use std::collections::HashSet;

/// The sink inputs in `pactl list sink-inputs` (run with `LC_ALL=C`), as their index and
/// the process that plays them.
pub fn sink_inputs(listing: &str) -> Vec<(u32, i32)> {
    let mut found = Vec::new();
    let mut current: Option<u32> = None;
    for line in listing.lines() {
        let line = line.trim();
        if let Some(index) = line.strip_prefix("Sink Input #") {
            current = index.trim().parse().ok();
        } else if let (Some(index), Some(pid)) = (current, property(line, "application.process.id"))
            && let Ok(pid) = pid.parse()
        {
            found.push((index, pid));
        }
    }
    found
}

/// The value of `name = "value"`.
fn property<'a>(line: &'a str, name: &str) -> Option<&'a str> {
    let value = line
        .strip_prefix(name)?
        .trim_start()
        .strip_prefix('=')?
        .trim();
    Some(value.trim_matches('"'))
}

/// The parent of a process, from `/proc/<pid>/stat`: `pid (name) state ppid ...`. The
/// name may hold spaces and brackets, so the fields are read after the last `)`.
pub fn parent_in_stat(stat: &str) -> Option<i32> {
    let rest = &stat[stat.rfind(')')? + 1..];
    rest.split_whitespace().nth(1)?.parse().ok()
}

/// `root` and every process below it, from `(pid, parent)` pairs.
pub fn family(root: i32, parents: &[(i32, i32)]) -> HashSet<i32> {
    let mut family = HashSet::from([root]);
    loop {
        let before = family.len();
        for &(pid, parent) in parents {
            if family.contains(&parent) {
                family.insert(pid);
            }
        }
        if family.len() == before {
            return family;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LISTING: &str = r#"Sink Input #41
	Driver: PipeWire
	Owner Module: n/a
	Sink: 52
	Properties:
		application.name = "Firefox"
		application.process.id = "2210"
		media.name = "AudioStream"

Sink Input #57
	Driver: PipeWire
	Properties:
		application.name = "wine64-preloader"
		application.process.id = "3315"
"#;

    #[test]
    fn lists_streams_with_their_process() {
        assert_eq!(sink_inputs(LISTING), [(41, 2210), (57, 3315)]);
        assert_eq!(sink_inputs(""), []);
    }

    #[test]
    fn reads_the_parent_after_a_tricky_name() {
        assert_eq!(
            parent_in_stat("3315 (wine (game) x) S 3001 3315 ..."),
            Some(3001)
        );
        assert_eq!(parent_in_stat("garbage"), None);
    }

    #[test]
    fn the_family_takes_children_and_grandchildren() {
        // Steam (1) starts the game (10), which starts Wine (11), which plays sound (12).
        let parents = [(10, 1), (11, 10), (12, 11), (20, 1)];
        assert_eq!(family(10, &parents), HashSet::from([10, 11, 12]));
    }
}
