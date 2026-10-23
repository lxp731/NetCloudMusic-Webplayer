//! Shared constants. Mirrors src/shared/config.js from the Electron shell.

pub const APP_NAME: &str = "netcloud-music"; // used for paths (no spaces)
pub const PRODUCT_NAME: &str = "网易云音乐"; // window title, tray, MPRIS, menus
pub const DESKTOP_ENTRY: &str = "netcloud-music";

/// MPRIS bus name suffix → `org.mpris.MediaPlayer2.netcloud_music`.
pub const MPRIS_SUFFIX: &str = "netcloud_music";

/// The official web player. Override with NETCLOUD_URL for testing.
pub const PLAYER_URL: &str = "https://music.163.com/st/webplayer";

/// Present ourselves as plain Chrome. The site sniffs the UA and only enables
/// some paths for "known" browsers.
pub const USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

/// Hosts the shell is allowed to navigate to / open inside the window.
/// Includes the third-party login hops (QQ / WeChat) so the QR flows keep
/// working in-app; anything else is handed to the system browser.
const ALLOWED_HOST_SUFFIXES: &[&str] = &[
    "music.163.com",
    "163.com",
    "126.net",
    "127.net",
    "163yun.com",
    "netease.com",
    "qq.com",
    "weixin.qq.com",
];

pub fn player_url() -> String {
    std::env::var("NETCLOUD_URL").unwrap_or_else(|_| PLAYER_URL.to_string())
}

/// `isAllowedUrl` from config.js: http(s) and host is (or is under) an allowed
/// host. A bare "163.com" also matches "music.163.com" via suffix matching.
pub fn is_allowed_url(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "https" && parsed.scheme() != "http" {
        return false;
    }
    let host = parsed.host_str().unwrap_or("").to_lowercase();
    if host.is_empty() {
        return false;
    }
    ALLOWED_HOST_SUFFIXES
        .iter()
        .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
}
