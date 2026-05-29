//! Desktop tray and application menu.
//!
//! This module is the system-shell layer only: window visibility, opening
//! local files, and triggering the existing scan pipeline. Agent parsing and
//! aggregation remain in core / watcher.

use crate::events::{ErrorPayload, GARDEN_ERROR, GARDEN_SCANNING, GARDEN_UPDATED, ScanningPayload};
use crate::watcher;
use local_agent_garden_core::settings::{self, Settings};
use local_agent_garden_core::storage;
use std::path::Path;
use std::process::Command;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, Runtime, Window, WindowEvent};

const WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "local-agent-garden";

const MENU_SHOW: &str = "garden-show";
const MENU_HIDE: &str = "garden-hide";
const MENU_SCAN: &str = "garden-scan";
const MENU_OPEN_SETTINGS: &str = "garden-open-settings";
const MENU_OPEN_DATA_DIR: &str = "garden-open-data-dir";
const MENU_QUIT: &str = "garden-quit";

pub fn setup(app: &mut App) -> tauri::Result<()> {
    let tray_menu = build_control_menu(app.handle())?;
    TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Local Agent Garden")
        .icon(tauri::include_image!("./icons/32x32.png"))
        .menu(&tray_menu)
        .show_menu_on_left_click(true)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } | TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

pub fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let controls = build_control_submenu(app, "Garden")?;
    Menu::with_items(app, &[&controls])
}

pub fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        MENU_SHOW => show_main_window(app),
        MENU_HIDE => hide_main_window(app),
        MENU_SCAN => trigger_scan(app),
        MENU_OPEN_SETTINGS => open_settings(app),
        MENU_OPEN_DATA_DIR => open_data_dir(app),
        MENU_QUIT => app.exit(0),
        _ => {}
    }
}

pub fn handle_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if window.label() != WINDOW_LABEL {
        return;
    }

    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        if let Err(err) = window.hide() {
            eprintln!("[tray] hide on close failed: {err}");
        }
    }
}

fn build_control_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let show = MenuItem::with_id(
        app,
        MENU_SHOW,
        "Show Garden",
        true,
        Some("CmdOrCtrl+Shift+G"),
    )?;
    let hide = MenuItem::with_id(app, MENU_HIDE, "Hide Window", true, Some("CmdOrCtrl+H"))?;
    let scan = MenuItem::with_id(app, MENU_SCAN, "Scan Now", true, Some("CmdOrCtrl+R"))?;
    let open_settings =
        MenuItem::with_id(app, MENU_OPEN_SETTINGS, "Open Settings", true, None::<&str>)?;
    let open_data_dir = MenuItem::with_id(
        app,
        MENU_OPEN_DATA_DIR,
        "Open Data Folder",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, Some("CmdOrCtrl+Q"))?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    Menu::with_items(
        app,
        &[
            &show,
            &hide,
            &sep1,
            &scan,
            &open_settings,
            &open_data_dir,
            &sep2,
            &quit,
        ],
    )
}

fn build_control_submenu<R: Runtime>(app: &AppHandle<R>, title: &str) -> tauri::Result<Submenu<R>> {
    let show = MenuItem::with_id(
        app,
        MENU_SHOW,
        "Show Garden",
        true,
        Some("CmdOrCtrl+Shift+G"),
    )?;
    let hide = MenuItem::with_id(app, MENU_HIDE, "Hide Window", true, Some("CmdOrCtrl+H"))?;
    let scan = MenuItem::with_id(app, MENU_SCAN, "Scan Now", true, Some("CmdOrCtrl+R"))?;
    let open_settings =
        MenuItem::with_id(app, MENU_OPEN_SETTINGS, "Open Settings", true, None::<&str>)?;
    let open_data_dir = MenuItem::with_id(
        app,
        MENU_OPEN_DATA_DIR,
        "Open Data Folder",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, Some("CmdOrCtrl+Q"))?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    Submenu::with_items(
        app,
        title,
        true,
        &[
            &show,
            &hide,
            &sep1,
            &scan,
            &open_settings,
            &open_data_dir,
            &sep2,
            &quit,
        ],
    )
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        if let Err(err) = window.show().and_then(|_| window.set_focus()) {
            emit_error(app, "tray", format!("show window: {err}"));
        }
    }
}

fn hide_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(WINDOW_LABEL)
        && let Err(err) = window.hide()
    {
        emit_error(app, "tray", format!("hide window: {err}"));
    }
}

fn trigger_scan<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        let _ = app.emit(GARDEN_SCANNING, &ScanningPayload { adapter: None });
        match watcher::run_summary_blocking() {
            Ok(summary) => {
                if let Err(err) = app.emit(GARDEN_UPDATED, &summary) {
                    eprintln!("[tray] emit updated failed: {err}");
                }
            }
            Err(err) => {
                emit_error(&app, "tray", err);
            }
        }
    });
}

fn open_settings<R: Runtime>(app: &AppHandle<R>) {
    let path = settings::default_settings_path();
    if !path.exists()
        && let Err(err) = settings::save(&path, &Settings::default())
    {
        emit_error(app, "tray", format!("create settings.toml: {err}"));
        return;
    }
    open_path(app, &path, "settings.toml");
}

fn open_data_dir<R: Runtime>(app: &AppHandle<R>) {
    let dir = storage::default_state_dir();
    if let Err(err) = std::fs::create_dir_all(&dir) {
        emit_error(app, "tray", format!("create data folder: {err}"));
        return;
    }
    open_path(app, &dir, "data folder");
}

fn open_path<R: Runtime>(app: &AppHandle<R>, path: &Path, label: &str) {
    if let Err(err) = spawn_open(path) {
        emit_error(app, "tray", format!("open {label}: {err}"));
    }
}

#[cfg(target_os = "macos")]
fn spawn_open(path: &Path) -> std::io::Result<()> {
    Command::new("open").arg(path).spawn().map(|_| ())
}

#[cfg(target_os = "windows")]
fn spawn_open(path: &Path) -> std::io::Result<()> {
    Command::new("explorer").arg(path).spawn().map(|_| ())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn spawn_open(path: &Path) -> std::io::Result<()> {
    Command::new("xdg-open").arg(path).spawn().map(|_| ())
}

fn emit_error<R: Runtime>(app: &AppHandle<R>, source: &'static str, message: impl Into<String>) {
    let payload = ErrorPayload::new(source, message);
    if let Err(err) = app.emit(GARDEN_ERROR, &payload) {
        eprintln!("[tray] emit error event failed: {err}");
    }
}
