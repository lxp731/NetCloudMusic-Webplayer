//! Tiny logger: stderr via `env_logger`. The file path is reserved for a future
//! file sink (and for the "open log" menu item).

use std::path::PathBuf;

fn log_dir() -> PathBuf {
    // ~/.local/state/netcloud-music  (XDG_STATE_HOME)
    let base = std::env::var("XDG_STATE_HOME").unwrap_or_else(|_| {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        format!("{home}/.local/state")
    });
    PathBuf::from(base).join(super::config::APP_NAME)
}

pub fn init() {
    let filter = if std::env::var("NETCLOUD_VERBOSE").is_ok() {
        "debug"
    } else {
        "info"
    };
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or(filter))
        .format_timestamp_millis()
        .try_init();
}

#[allow(dead_code)]
pub fn log_file() -> PathBuf {
    log_dir().join("netcloud-music.log")
}
