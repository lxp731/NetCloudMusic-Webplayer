//! MPRIS2 implementation, ported from src/main/mpris.js (dbus-next) to the
//! `mpris-server` crate (zbus). Exposes `org.mpris.MediaPlayer2` and
//! `org.mpris.MediaPlayer2.Player` on the session bus.
//!
//! Why MPRIS instead of global shortcuts: on Wayland global shortcuts cannot
//! grab media keys reliably, and grabbing them would also steal them from other
//! players. KDE/GNOME route the keyboard/headset media keys through MPRIS, so a
//! correct MPRIS service gets media keys for free.

use std::sync::Arc;

use mpris_server::{
    LoopStatus, Metadata, PlaybackRate, PlaybackStatus, PlayerInterface, Property, RootInterface,
    Server, Signal, Time, TrackId, Volume,
};
use mpris_server::zbus::{fdo, Result};
use tauri::{AppHandle, Manager};

use crate::command::{send_command, Command};
use crate::config;
use crate::media::{MediaState, MediaStore};

fn artist_list(artist: &str) -> Vec<String> {
    artist
        .split(|c: char| matches!(c, ',' | '，' | '/' | '、' | '&'))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect()
}

fn metadata_of(s: &MediaState, track_id: &str) -> Metadata {
    let mut md = Metadata::new();
    let tid = TrackId::try_from(track_id)
        .unwrap_or_else(|_| TrackId::try_from("/org/mpris/MediaPlayer2/Track/none").unwrap());
    md.set_trackid(Some(tid));
    md.set_length(Some(Time::from_micros((s.duration * 1e6).round() as i64)));
    if !s.title.is_empty() {
        md.set_title(Some(s.title.clone()));
    }
    let artists = artist_list(&s.artist);
    if !artists.is_empty() {
        md.set_artist(Some(artists));
    }
    if !s.album.is_empty() {
        md.set_album(Some(s.album.clone()));
    }
    if !s.artwork.is_empty() {
        md.set_art_url(Some(s.artwork.clone()));
    }
    md
}

pub struct PlayerImpl {
    store: Arc<MediaStore>,
    app: AppHandle,
}

impl RootInterface for PlayerImpl {
    async fn raise(&self) -> fdo::Result<()> {
        if let Some(w) = self.app.get_webview_window("main") {
            let _ = w.show();
            let _ = w.set_focus();
        }
        Ok(())
    }

    async fn quit(&self) -> fdo::Result<()> {
        crate::quit(&self.app);
        Ok(())
    }

    async fn can_quit(&self) -> fdo::Result<bool> {
        Ok(true)
    }

    async fn fullscreen(&self) -> fdo::Result<bool> {
        Ok(false)
    }

    async fn set_fullscreen(&self, _fullscreen: bool) -> Result<()> {
        Ok(())
    }

    async fn can_set_fullscreen(&self) -> fdo::Result<bool> {
        Ok(false)
    }

    async fn can_raise(&self) -> fdo::Result<bool> {
        Ok(true)
    }

    async fn has_track_list(&self) -> fdo::Result<bool> {
        Ok(false)
    }

    async fn identity(&self) -> fdo::Result<String> {
        Ok(config::PRODUCT_NAME.to_string())
    }

    async fn desktop_entry(&self) -> fdo::Result<String> {
        Ok(format!("{}.desktop", config::DESKTOP_ENTRY))
    }

    async fn supported_uri_schemes(&self) -> fdo::Result<Vec<String>> {
        Ok(vec!["https".into(), "http".into()])
    }

    async fn supported_mime_types(&self) -> fdo::Result<Vec<String>> {
        Ok(vec![])
    }
}

impl PlayerInterface for PlayerImpl {
    async fn next(&self) -> fdo::Result<()> {
        send_command(&self.app, &Command::Next);
        Ok(())
    }

    async fn previous(&self) -> fdo::Result<()> {
        send_command(&self.app, &Command::Prev);
        Ok(())
    }

    async fn pause(&self) -> fdo::Result<()> {
        send_command(&self.app, &Command::Pause);
        Ok(())
    }

    async fn play_pause(&self) -> fdo::Result<()> {
        send_command(&self.app, &Command::PlayPause);
        Ok(())
    }

    async fn stop(&self) -> fdo::Result<()> {
        send_command(&self.app, &Command::Pause);
        Ok(())
    }

    async fn play(&self) -> fdo::Result<()> {
        send_command(&self.app, &Command::Play);
        Ok(())
    }

    async fn seek(&self, offset: Time) -> fdo::Result<()> {
        let cur = self.store.current_position();
        let mut target = (cur + offset.as_micros() as f64 / 1e6).max(0.0);
        let dur = self.store.snapshot().duration;
        if dur > 0.0 {
            target = target.min(dur);
        }
        send_command(&self.app, &Command::Seek { value: target });
        Ok(())
    }

    async fn set_position(&self, track_id: TrackId, position: Time) -> fdo::Result<()> {
        let current = self.store.track_id();
        let requested = track_id.into_inner().to_string();
        if !requested.is_empty() && requested != current {
            return Ok(()); // not the current track
        }
        let value = (position.as_micros() as f64 / 1e6).max(0.0);
        send_command(&self.app, &Command::Seek { value });
        Ok(())
    }

    async fn open_uri(&self, uri: String) -> fdo::Result<()> {
        send_command(&self.app, &Command::Open { value: uri });
        Ok(())
    }

    async fn playback_status(&self) -> fdo::Result<PlaybackStatus> {
        Ok(match self.store.snapshot().status.as_str() {
            "Playing" => PlaybackStatus::Playing,
            "Paused" => PlaybackStatus::Paused,
            _ => PlaybackStatus::Stopped,
        })
    }

    async fn loop_status(&self) -> fdo::Result<LoopStatus> {
        Ok(LoopStatus::None)
    }

    async fn set_loop_status(&self, loop_status: LoopStatus) -> Result<()> {
        let v = match loop_status {
            LoopStatus::None => "none",
            LoopStatus::Track => "track",
            LoopStatus::Playlist => "playlist",
        };
        send_command(&self.app, &Command::Loop { value: v.to_string() });
        Ok(())
    }

    async fn rate(&self) -> fdo::Result<PlaybackRate> {
        Ok(1.0)
    }

    async fn set_rate(&self, _rate: PlaybackRate) -> Result<()> {
        Ok(())
    }

    async fn shuffle(&self) -> fdo::Result<bool> {
        Ok(false)
    }

    async fn set_shuffle(&self, shuffle: bool) -> Result<()> {
        send_command(&self.app, &Command::Shuffle { value: shuffle });
        Ok(())
    }

    async fn metadata(&self) -> fdo::Result<Metadata> {
        let s = self.store.snapshot();
        Ok(metadata_of(&s, &self.store.track_id()))
    }

    async fn volume(&self) -> fdo::Result<Volume> {
        Ok(self.store.snapshot().volume.clamp(0.0, 1.0))
    }

    async fn set_volume(&self, volume: Volume) -> Result<()> {
        let v = volume.clamp(0.0, 1.0);
        // optimistically reflect it; the page will confirm via volumechange
        let patch = serde_json::json!({ "volume": v });
        self.store.update(&patch);
        send_command(&self.app, &Command::Volume { value: v });
        Ok(())
    }

    async fn position(&self) -> fdo::Result<Time> {
        Ok(Time::from_micros(
            (self.store.current_position() * 1e6).round() as i64,
        ))
    }

    async fn minimum_rate(&self) -> fdo::Result<PlaybackRate> {
        Ok(1.0)
    }

    async fn maximum_rate(&self) -> fdo::Result<PlaybackRate> {
        Ok(1.0)
    }

    async fn can_go_next(&self) -> fdo::Result<bool> {
        Ok(true)
    }

    async fn can_go_previous(&self) -> fdo::Result<bool> {
        Ok(true)
    }

    async fn can_play(&self) -> fdo::Result<bool> {
        Ok(true)
    }

    async fn can_pause(&self) -> fdo::Result<bool> {
        Ok(true)
    }

    async fn can_seek(&self) -> fdo::Result<bool> {
        Ok(true)
    }

    async fn can_control(&self) -> fdo::Result<bool> {
        Ok(true)
    }
}

/// Owns the MPRIS `Server` for the lifetime of the app. `sync` is called by the
/// shell whenever the media state changes; it emits `PropertiesChanged`.
pub struct MprisService {
    server: Arc<Server<PlayerImpl>>,
}

impl MprisService {
    pub async fn start(store: Arc<MediaStore>, app: AppHandle) -> Result<Self> {
        let imp = PlayerImpl { store, app };
        let server = Server::new(config::MPRIS_SUFFIX, imp).await?;
        Ok(Self {
            server: Arc::new(server),
        })
    }

    pub fn sync(&self, store: &MediaStore, changed: &[String]) {
        let s = store.snapshot();
        let mut props: Vec<Property> = Vec::new();

        if changed.iter().any(|c| c == "status") {
            props.push(Property::PlaybackStatus(match s.status.as_str() {
                "Playing" => PlaybackStatus::Playing,
                "Paused" => PlaybackStatus::Paused,
                _ => PlaybackStatus::Stopped,
            }));
        }
        if changed
            .iter()
            .any(|c| ["title", "artist", "album", "artwork", "duration", "trackKey"].contains(&c.as_str()))
        {
            props.push(Property::Metadata(metadata_of(&s, &store.track_id())));
        }
        if changed.iter().any(|c| c == "volume") {
            props.push(Property::Volume(s.volume.clamp(0.0, 1.0)));
        }

        if props.is_empty() {
            return;
        }
        let server = self.server.clone();
        tauri::async_runtime::spawn(async move {
            let _ = server.properties_changed(props).await;
        });
    }

    #[allow(dead_code)] // wired up when seek reporting is added
    pub fn seeked(&self, position_sec: f64) {
        let server = self.server.clone();
        tauri::async_runtime::spawn(async move {
            let _ = server
                .emit(Signal::Seeked {
                    position: Time::from_micros((position_sec * 1e6).round() as i64),
                })
                .await;
        });
    }
}
