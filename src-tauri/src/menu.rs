//! Application menu bar. Ported from src/main/menu.js. Kept minimal for the
//! MVP: reload, quit, logout, about.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle,
};

pub fn build_menu(app: &AppHandle) -> tauri::Result<()> {
    let reload = MenuItem::with_id(app, "reload", "重新加载", true, Some("CmdOrCtrl+R"))?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, Some("CmdOrCtrl+Q"))?;

    let app_menu = Submenu::new(app, super::config::PRODUCT_NAME, true)?;
    app_menu.append(&reload)?;
    app_menu.append(&PredefinedMenuItem::separator(app)?)?;
    app_menu.append(&quit)?;

    let logout = MenuItem::with_id(app, "logout", "退出登录（清除本机数据）", true, None::<&str>)?;
    let account = Submenu::new(app, "账户", true)?;
    account.append(&logout)?;

    let about = MenuItem::with_id(app, "about", "关于", true, None::<&str>)?;
    let help = Submenu::new(app, "帮助", true)?;
    help.append(&about)?;

    let menu = Menu::with_items(app, &[&app_menu, &account, &help])?;
    app.set_menu(menu)?;
    Ok(())
}
