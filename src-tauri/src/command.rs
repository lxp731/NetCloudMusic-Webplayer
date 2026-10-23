//! Commands sent from the shell (MPRIS / tray) into the page world.
//! Serialized shape matches what src/preload/page-hook.js expects: a flat
//! object with a `type` field and an optional `value`.

use serde::Serialize;
use tauri::Manager;

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type")]
pub enum Command {
    #[serde(rename = "play")]
    Play,
    #[serde(rename = "pause")]
    Pause,
    #[serde(rename = "playpause")]
    PlayPause,
    #[serde(rename = "next")]
    Next,
    #[serde(rename = "prev")]
    Prev,
    #[serde(rename = "seek")]
    Seek { value: f64 },
    #[serde(rename = "volume")]
    Volume { value: f64 },
    #[serde(rename = "loop")]
    Loop { value: String },
    #[serde(rename = "shuffle")]
    Shuffle { value: bool },
    #[serde(rename = "open")]
    Open { value: String },
}

/// Deliver a command to the page world. `page-hook.js` listens on
/// `window.postMessage` for `{__netcloud:true, kind:'command', cmd}` and we
/// push that message in via `eval` (the Rust → page direction of the bridge).
pub fn send_command(app: &tauri::AppHandle, cmd: &Command) {
    let Some(win) = app.get_webview_window("main") else {
        log::warn!("[cmd] no window");
        return;
    };
    let Ok(json) = serde_json::to_string(cmd) else {
        return;
    };
    let script = format!(
        "if (window.__netcloudCommand) {{ window.__netcloudCommand({json}) }} else {{ window.postMessage({{__netcloud:true, kind:'command', cmd:{json}}}, '*') }}"
    );
    log::debug!("[cmd] {json}");
    if let Err(e) = win.eval(&script) {
        log::warn!("[cmd] eval failed: {e}");
    }
}
