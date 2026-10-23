//! Main window: loads the official web player, injects the page hook + bridge,
//! restricts navigation to the allowed hosts, persists window geometry, and
//! hides to the tray on close. Ported from src/main/window.js + session.js.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri::webview::NewWindowResponse;
use tauri::window::Color;

use crate::config;

static PAGE_HOOK: &str = include_str!("../assets/page-hook.js");
static BRIDGE: &str = include_str!("../assets/bridge.js");
static CHROME_SPOOF: &str = include_str!("../assets/chrome-spoof.js");

static TRAY_AVAILABLE: AtomicBool = AtomicBool::new(false);
static QUITTING: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Debug, Serialize, Deserialize)]
struct WindowState {
    width: f64,
    height: f64,
    x: f64,
    y: f64,
    maximized: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            width: 1280.0,
            height: 820.0,
            x: 0.0,
            y: 0.0,
            maximized: false,
        }
    }
}

static NORMAL_BOUNDS: Mutex<Option<WindowState>> = Mutex::new(None);

fn state_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("window-state.json"))
}

fn load_state(app: &AppHandle) -> WindowState {
    let mut state = match state_path(app).and_then(|p| std::fs::read_to_string(p).ok()) {
        Some(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        None => WindowState::default(),
    };
    // Guard against corrupt/stale values (e.g. physical pixels saved as logical
    // by an older build): never restore a window larger than the screen.
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let scale = monitor.scale_factor();
        let screen = monitor.size().to_logical::<f64>(scale);
        if state.width > screen.width + 64.0 || state.height > screen.height + 64.0 {
            log::warn!(
                "[window] saved size {}x{} exceeds screen {}x{}, resetting to default",
                state.width,
                state.height,
                screen.width,
                screen.height
            );
            state = WindowState::default();
        }
    }
    state
}

pub fn save_state(app: &AppHandle) {
    let bounds = NORMAL_BOUNDS.lock().unwrap().clone().unwrap_or_default();
    let Some(path) = state_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string(&bounds) {
        let _ = std::fs::write(&path, json);
    }
}

fn open_external(url: &str) {
    // xdg-open detaches and routes to the right handler on any desktop.
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
}

pub fn create_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let state = load_state(app);
    let url = config::player_url();
    let external = WebviewUrl::External(
        url.parse()
            .unwrap_or_else(|e| panic!("invalid NETCLOUD_URL ({url}): {e}")),
    );

    let app_for_new_window = app.clone();
    let builder = WebviewWindowBuilder::new(app, "main", external)
        .title(config::PRODUCT_NAME)
        .inner_size(state.width, state.height)
        .min_inner_size(900.0, 600.0)
        .background_color(Color(0, 0, 0, 255))
        .user_agent(config::USER_AGENT)
        .initialization_script(CHROME_SPOOF)
        .initialization_script(PAGE_HOOK)
        .initialization_script(BRIDGE)
        .on_navigation(|url| {
            let s = url.as_str();
            if config::is_allowed_url(s) {
                true
            } else {
                log::info!("[window] external navigation blocked: {s}");
                open_external(s);
                false
            }
        })
        .on_new_window(move |url, _features| {
            // Never open a second window for site content: same-site popups are
            // navigations in disguise, anything else goes to the system browser.
            let s = url.as_str();
            if config::is_allowed_url(s) {
                if let Some(w) = app_for_new_window.get_webview_window("main") {
                    let _ = w.navigate(url);
                }
            } else {
                log::info!("[window] external new window blocked: {s}");
                open_external(s);
            }
            NewWindowResponse::Deny
        })
        .on_page_load(|_window, payload| {
            log::info!(
                "[window] page {} {}",
                if payload.event() == tauri::webview::PageLoadEvent::Started {
                    "started"
                } else {
                    "finished"
                },
                payload.url()
            );
        });

    let win = builder.build()?;

    if state.maximized {
        let _ = win.maximize();
    }
    // Seed the normal bounds tracker.
    {
        let mut g = NORMAL_BOUNDS.lock().unwrap();
        *g = Some(state);
    }

    let app_for_events = app.clone();
    win.on_window_event(move |event| {
        use tauri::WindowEvent as E;
        match event {
            E::CloseRequested { api, .. } => {
                if !QUITTING.load(Ordering::SeqCst) && TRAY_AVAILABLE.load(Ordering::SeqCst) {
                    api.prevent_close();
                    save_state(&app_for_events);
                    if let Some(w) = app_for_events.get_webview_window("main") {
                        let _ = w.hide();
                    }
                    log::info!("[window] hidden to tray");
                } else {
                    save_state(&app_for_events);
                }
            }
            E::Resized(size) => {
                // Track the *normal* (unmaximized) size only, so restoring after
                // a maximized session keeps the last normal geometry. The event
                // reports physical pixels; store logical pixels instead.
                if let Some(w) = app_for_events.get_webview_window("main") {
                    if !w.is_maximized().unwrap_or(false) {
                        let scale = w.scale_factor().unwrap_or(1.0);
                        let logical = size.to_logical::<f64>(scale);
                        if let Ok(mut g) = NORMAL_BOUNDS.lock() {
                            if let Some(s) = g.as_mut() {
                                s.width = logical.width;
                                s.height = logical.height;
                            }
                        }
                    }
                }
            }
            E::Moved(pos) => {
                if let Some(w) = app_for_events.get_webview_window("main") {
                    let scale = w.scale_factor().unwrap_or(1.0);
                    let logical = pos.to_logical::<f64>(scale);
                    if let Ok(mut g) = NORMAL_BOUNDS.lock() {
                        if let Some(s) = g.as_mut() {
                            s.x = logical.x;
                            s.y = logical.y;
                        }
                    }
                }
            }
            _ => {}
        }
    });

    Ok(win)
}

pub fn set_tray_available(v: bool) {
    TRAY_AVAILABLE.store(v, Ordering::SeqCst);
}

pub fn mark_quitting() {
    QUITTING.store(true, Ordering::SeqCst);
}

pub fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[allow(dead_code)]
pub fn toggle_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let visible = w.is_visible().unwrap_or(false);
        let minimized = w.is_minimized().unwrap_or(false);
        if visible && !minimized {
            let _ = w.hide();
        } else {
            show_window(app);
        }
    }
}

pub fn reload(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let url = config::player_url();
        let _ = w.navigate(url.parse::<tauri::Url>().expect("valid player URL"));
    }
}

/// Clear the site's cookies / storage so "log out" works, then reload.
pub fn logout(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        if let Err(e) = w.clear_all_browsing_data() {
            log::warn!("[window] clear_all_browsing_data failed: {e}");
        }
    }
    reload(app);
    log::info!("[window] site data cleared");
}


