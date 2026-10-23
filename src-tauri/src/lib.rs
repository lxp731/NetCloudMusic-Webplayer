//! netcloud-music — Tauri shell for the NetEase Cloud Music web player.
//!
//! Architecture mirrors the Electron original: a native shell (Rust) wraps the
//! official web player, a page-world hook reports media state, and MPRIS / tray
//! / menu provide desktop integration.

mod command;
mod config;
mod logger;
mod media;
mod menu;
mod mpris;
mod tray;
mod window;

use std::sync::Arc;

use tauri::Manager;

use media::MediaStore;

/// Shared application state, managed by Tauri.
struct AppState {
    store: Arc<MediaStore>,
    mpris: Option<mpris::MprisService>,
    tray: Option<tray::Tray>,
}

/// Clean shutdown: save window state and let the app exit.
pub fn quit(app: &tauri::AppHandle) {
    window::mark_quitting();
    window::save_state(app);
    app.exit(0);
}

// ------------------------------------------------------------------ commands

#[tauri::command]
fn media_state(state: tauri::State<'_, AppState>, payload: serde_json::Value) {
    let store = state.store.clone();
    let result = store.update(&payload);
    if result.changed.is_empty() {
        return;
    }
    if result.track_changed {
        let s = store.snapshot();
        log::info!("[media] track: {} — {} ({})", s.title, s.artist, s.source);
    }
    if let Some(mpris) = &state.mpris {
        mpris.sync(&store, &result.changed);
    }
    if let Some(tray) = &state.tray {
        tray.refresh(&store);
    }
}

#[tauri::command]
fn page_event(payload: serde_json::Value) {
    let kind = payload.get("kind").and_then(|v| v.as_str()).unwrap_or("?");
    log::info!(
        "[page] {kind} {}",
        serde_json::to_string(&payload).unwrap_or_default()
    );
}

#[tauri::command]
fn page_probe(payload: serde_json::Value) {
    let pretty = serde_json::to_string_pretty(&payload).unwrap_or_default();
    log::info!("[probe] {pretty}");
    println!("[probe] {pretty}");
}

#[tauri::command]
fn shell_retry(app: tauri::AppHandle) {
    window::reload(&app);
}

#[tauri::command]
fn shell_info(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> serde_json::Value {
    serde_json::json!({
        "version": app.package_info().version.to_string(),
        "state": state.store.snapshot(),
    })
}

// --------------------------------------------------------------------- setup

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logger::init();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            window::show_window(app);
        }))
        .invoke_handler(tauri::generate_handler![
            media_state,
            page_event,
            page_probe,
            shell_retry,
            shell_info
        ])
        .on_menu_event(|app, event| match event.id().as_ref() {
            "reload" => window::reload(app),
            "quit" => quit(app),
            "logout" => window::logout(app),
            "about" => log::info!("[menu] about (version {})", app.package_info().version),
            _ => {}
        })
        .setup(|app| {
            let store = Arc::new(MediaStore::new());

            let win = window::create_window(app.handle())?;
            log::info!("[window] created, loading {}", config::player_url());

            // MPRIS (needs an async context; Tauri's runtime is tokio).
            let store_for_mpris = store.clone();
            let app_for_mpris = app.handle().clone();
            let mpris = tauri::async_runtime::block_on(async move {
                mpris::MprisService::start(store_for_mpris, app_for_mpris).await
            });
            let mpris = match mpris {
                Ok(m) => {
                    log::info!("[mpris] exported org.mpris.MediaPlayer2.{}", config::MPRIS_SUFFIX);
                    Some(m)
                }
                Err(e) => {
                    log::error!("[mpris] failed to start: {e}");
                    None
                }
            };

            // Tray.
            let tray = match tray::Tray::build(app.handle()) {
                Ok(Some(t)) => {
                    window::set_tray_available(true);
                    log::info!("[tray] created");
                    Some(t)
                }
                Ok(None) => {
                    window::set_tray_available(false);
                    log::warn!("[tray] unavailable (close will quit the app)");
                    None
                }
                Err(e) => {
                    window::set_tray_available(false);
                    log::warn!("[tray] failed: {e}");
                    None
                }
            };

            // Application menu.
            if let Err(e) = menu::build_menu(app.handle()) {
                log::warn!("[menu] failed: {e}");
            }

            app.manage(AppState { store, mpris, tray });

            // The window reference is kept alive by Tauri's window manager; we
            // only need the handle for logs/dev tools.
            drop(win);

            log::info!("[main] ready");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
