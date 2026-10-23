//! Single source of truth for "what is playing". Fed by the page hook through
//! Tauri IPC, consumed by MPRIS and the tray.
//!
//! The page only reports the position every ~250ms (timeupdate); between those
//! reports we extrapolate locally so MPRIS clients see a smooth Position.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;
use std::time::Instant;

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct MediaState {
    pub status: String, // Playing | Paused | Stopped
    pub title: String,
    pub artist: String,
    pub album: String,
    pub artwork: String,
    pub duration: f64,   // seconds
    pub position: f64,   // seconds, as of position_at
    pub volume: f64,
    pub can_next: bool,
    pub can_prev: bool,
    pub can_play: bool,
    pub can_seek: bool,
    pub track_key: String,
    pub source: String, // metadata source, for diagnostics
}

impl MediaState {
    pub fn new() -> Self {
        Self {
            status: "Stopped".to_string(),
            volume: 1.0,
            can_next: true,
            can_prev: true,
            can_play: true,
            can_seek: true,
            ..Default::default()
        }
    }
}

#[derive(Default)]
pub struct UpdateResult {
    pub changed: Vec<String>,
    pub track_changed: bool,
}

pub struct MediaStore {
    state: Mutex<MediaState>,
    position_at: Mutex<Instant>,
}

impl MediaStore {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(MediaState::new()),
            position_at: Mutex::new(Instant::now()),
        }
    }

    pub fn snapshot(&self) -> MediaState {
        let mut s = self.state.lock().unwrap().clone();
        s.position = self.current_position_locked(&s);
        s
    }

    pub fn current_position(&self) -> f64 {
        let s = self.state.lock().unwrap();
        self.current_position_locked(&s)
    }

    fn current_position_locked(&self, s: &MediaState) -> f64 {
        if s.status != "Playing" || s.duration <= 0.0 {
            return s.position;
        }
        let elapsed = self.position_at.lock().unwrap().elapsed().as_secs_f64();
        (s.position + elapsed.max(0.0)).min(s.duration)
    }

    pub fn track_id(&self) -> String {
        let s = self.state.lock().unwrap();
        let key = if s.track_key.is_empty() {
            format!("{}|{}", s.title, s.artist)
        } else {
            s.track_key.clone()
        };
        if key.trim().is_empty() {
            return "/org/mpris/MediaPlayer2/Track/none".to_string();
        }
        let hash = fnv1a64(&key);
        format!("/org/mpris/MediaPlayer2/Track/{hash:016x}")
    }

    /// Apply a patch reported by the page. Returns the keys that actually
    /// changed and whether the track identity changed.
    pub fn update(&self, patch: &Value) -> UpdateResult {
        let Some(obj) = patch.as_object() else {
            return UpdateResult::default();
        };

        let prev = self.state.lock().unwrap().clone();
        let mut next = prev.clone();
        let mut position_changed = false;

        for (key, value) in obj {
            match key.as_str() {
                "position" => {
                    if let Some(num) = value.as_f64() {
                        if num.is_finite() {
                            if (num - prev.position).abs() > 0.01 {
                                position_changed = true;
                            }
                            next.position = num;
                        }
                    }
                }
                "duration" | "volume" => {
                    if let Some(num) = value.as_f64() {
                        if num.is_finite() {
                            match key.as_str() {
                                "duration" => next.duration = num,
                                _ => next.volume = num,
                            }
                        }
                    }
                }
                "status" => {
                    if let Some(s) = value.as_str() {
                        next.status = s.to_string();
                    }
                }
                "title" | "artist" | "album" | "artwork" | "source" => {
                    if let Some(s) = value.as_str() {
                        match key.as_str() {
                            "title" => next.title = s.to_string(),
                            "artist" => next.artist = s.to_string(),
                            "album" => next.album = s.to_string(),
                            "artwork" => next.artwork = s.to_string(),
                            _ => next.source = s.to_string(),
                        }
                    }
                }
                "canNext" | "canPrev" | "canPlay" | "canSeek" => {
                    if let Some(b) = value.as_bool() {
                        match key.as_str() {
                            "canNext" => next.can_next = b,
                            "canPrev" => next.can_prev = b,
                            "canPlay" => next.can_play = b,
                            _ => next.can_seek = b,
                        }
                    }
                }
                _ => {} // unknown keys are ignored
            }
        }

        // track identity: rebuild the key whenever title/artist/album change
        let id_changed =
            next.title != prev.title || next.artist != prev.artist || next.album != prev.album;
        if id_changed || next.track_key.is_empty() {
            next.track_key = format!("{}|{}|{}", next.title, next.artist, next.album);
        }

        *self.state.lock().unwrap() = next.clone();
        if position_changed || id_changed || next.status != prev.status {
            *self.position_at.lock().unwrap() = Instant::now();
        }

        let mut changed = Vec::new();
        if next.status != prev.status {
            changed.push("status".to_string());
        }
        if next.title != prev.title {
            changed.push("title".to_string());
        }
        if next.artist != prev.artist {
            changed.push("artist".to_string());
        }
        if next.album != prev.album {
            changed.push("album".to_string());
        }
        if next.artwork != prev.artwork {
            changed.push("artwork".to_string());
        }
        if next.duration != prev.duration {
            changed.push("duration".to_string());
        }
        if next.volume != prev.volume {
            changed.push("volume".to_string());
        }
        if next.track_key != prev.track_key {
            changed.push("trackKey".to_string());
        }
        if position_changed {
            changed.push("position".to_string());
        }

        UpdateResult {
            changed,
            track_changed: id_changed,
        }
    }
}

/// FNV-1a 64-bit, deterministic across runs (pure function of the input).
fn fnv1a64(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}
