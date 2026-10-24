//! System tray (StatusNotifierItem via libappindicator on KDE) with a menu that
//! mirrors the current playback state. Ported from src/main/tray.js.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Wry,
};

use crate::command::{send_command, Command};
use crate::config;
use crate::media::MediaStore;

static TRAY_PNG: &[u8] = include_bytes!("../assets/tray.png");

pub struct Tray {
    play_item: MenuItem<Wry>,
    _tray: TrayIcon<Wry>,
}

impl Tray {
    pub fn build(app: &AppHandle) -> tauri::Result<Option<Self>> {
        let icon = match tauri::image::Image::from_bytes(TRAY_PNG) {
            Ok(img) => img,
            Err(e) => {
                log::warn!("[tray] cannot decode tray icon: {e}");
                return Ok(None);
            }
        };

        let play_item = MenuItem::with_id(app, "playpause", "播放", true, None::<&str>)?;
        let prev_item = MenuItem::with_id(app, "prev", "上一首", true, None::<&str>)?;
        let next_item = MenuItem::with_id(app, "next", "下一首", true, None::<&str>)?;
        let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
        let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;

        let menu = Menu::new(app)?;
        menu.append(&play_item)?;
        menu.append(&prev_item)?;
        menu.append(&next_item)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&show_item)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
        menu.append(&quit_item)?;

        let app_click = app.clone();
        let tray = TrayIconBuilder::with_id("main-tray")
            .icon(icon)
            .tooltip(config::PRODUCT_NAME)
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(move |app, event| match event.id.as_ref() {
                "playpause" => send_command(app, &Command::PlayPause),
                "prev" => send_command(app, &Command::Prev),
                "next" => send_command(app, &Command::Next),
                "show" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                "quit" => crate::quit(app),
                _ => {}
            })
            .on_tray_icon_event(move |_tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    if let Some(w) = app_click.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
            })
            .build(app)?;

        Ok(Some(Self {
            play_item,
            _tray: tray,
        }))
    }

    pub fn refresh(&self, store: &MediaStore) {
        let playing = store.snapshot().status == "Playing";
        let _ = self
            .play_item
            .set_text(if playing { "暂停" } else { "播放" });
    }
}
