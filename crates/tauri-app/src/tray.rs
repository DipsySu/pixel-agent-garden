//! Desktop tray and application menu.
//!
//! This module is the system-shell layer only: window visibility, opening
//! local files, and triggering the existing scan pipeline. Agent parsing and
//! aggregation remain in core / watcher.

use crate::events::{ErrorPayload, GARDEN_ERROR, GARDEN_SCANNING, GARDEN_UPDATED, ScanningPayload};
use crate::watcher;
use chrono::Utc;
use local_agent_garden_core::adapter::AdapterContext;
use local_agent_garden_core::aggregate::{GardenSummary, top_by_tokens};
use local_agent_garden_core::cache;
use local_agent_garden_core::rings;
use local_agent_garden_core::settings::{self, Settings};
use local_agent_garden_core::storage;
use std::path::Path;
use std::process::Command;
use std::sync::OnceLock;
use tauri::menu::{IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Listener, Manager, Runtime, Window, WindowEvent};

/// Menu-id prefix for a "open project in terminal" row. The project root is
/// encoded after the prefix so `handle_menu_event` can recover it without a
/// side table — the menu is rebuilt on every summary, so ids stay in sync.
const MENU_TERM_PREFIX: &str = "garden-term::";

pub const WINDOW_LABEL: &str = "main";
const TRAY_ID: &str = "local-agent-garden";

const MENU_SHOW: &str = "garden-show";
const MENU_HIDE: &str = "garden-hide";
const MENU_SCAN: &str = "garden-scan";
const MENU_OPEN_SETTINGS: &str = "garden-open-settings";
const MENU_OPEN_DATA_DIR: &str = "garden-open-data-dir";
const MENU_QUIT: &str = "garden-quit";
const MENU_STATUS: &str = "garden-status";
const MENU_TODAY_TOKENS: &str = "garden-today-tokens";

/// Tray copy is the one bilingual surface that cannot go through
/// `web/i18n.js`: native menus exist before (and without) the webview. The
/// en/zh pairs live at their call sites via `tr`, picked once by system
/// locale — the webview's `navigator.language` derives from the same system
/// setting, so both layers agree without a settings field or IPC.
fn locale_is_zh() -> bool {
    static IS_ZH: OnceLock<bool> = OnceLock::new();
    *IS_ZH.get_or_init(|| {
        sys_locale::get_locale()
            .map(|locale| locale.to_ascii_lowercase().starts_with("zh"))
            .unwrap_or(false)
    })
}

fn tr(en: &'static str, zh: &'static str) -> &'static str {
    if locale_is_zh() { zh } else { en }
}

pub fn setup(app: &mut App) -> tauri::Result<()> {
    // Initial menu has no project rows yet (the watcher only emits on change).
    let tray_menu = build_tray_menu(app.handle(), None)?;
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

    // Rebuild the "Top Token Projects" section whenever a fresh summary lands
    // (watcher / manual scan emit `garden:updated` with the full summary).
    let listen_handle = app.handle().clone();
    app.handle().listen(GARDEN_UPDATED, move |event| {
        if let Ok(summary) = serde_json::from_str::<GardenSummary>(event.payload()) {
            refresh_tray_menu(&listen_handle, summary);
        }
    });

    // Populate once at startup from the cache, since the watcher stays quiet
    // until something changes. Runs off-thread; the menu mutation hops back to
    // the main thread inside refresh_tray_menu.
    let init_handle = app.handle().clone();
    std::thread::spawn(move || {
        let ctx = AdapterContext::from_env();
        if let Ok(summary) = cache::summary_from_cache_or_scan(&ctx, None) {
            refresh_tray_menu(&init_handle, summary);
        }
    });

    Ok(())
}

/// Rebuild the tray menu from a new summary and swap it in. Menu mutation must
/// happen on the main thread, so the actual rebuild hops there via
/// `run_on_main_thread` regardless of which thread called us.
fn refresh_tray_menu(app: &AppHandle, summary: GardenSummary) {
    let handle = app.clone();
    let result = app.run_on_main_thread(move || match build_tray_menu(&handle, Some(&summary)) {
        Ok(menu) => {
            if let Some(tray) = handle.tray_by_id(TRAY_ID) {
                if let Err(err) = tray.set_menu(Some(menu)) {
                    eprintln!("[tray] set_menu failed: {err}");
                }
                if let Err(err) = tray.set_tooltip(Some(&tray_status_label(Some(&summary)))) {
                    eprintln!("[tray] set_tooltip failed: {err}");
                }
            }
        }
        Err(err) => eprintln!("[tray] rebuild menu failed: {err}"),
    });
    if let Err(err) = result {
        eprintln!("[tray] run_on_main_thread failed: {err}");
    }
}

pub fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let controls = build_control_submenu(app, "Garden")?;
    Menu::with_items(app, &[&controls])
}

pub fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    if let Some(path) = id.strip_prefix(MENU_TERM_PREFIX) {
        open_project_terminal(app, path);
        return;
    }
    match id {
        MENU_SHOW => show_main_window(app),
        MENU_HIDE => hide_main_window(app),
        MENU_SCAN => trigger_scan(app),
        MENU_OPEN_SETTINGS => open_settings(app),
        MENU_OPEN_DATA_DIR => open_data_dir(app),
        MENU_QUIT => app.exit(0),
        _ => {}
    }
}

/// Open a project root in the user's configured terminal. Spawned off-thread so
/// the menu handler returns immediately; failures surface via the error toast.
fn open_project_terminal(app: &AppHandle, path: &str) {
    let app = app.clone();
    let path = path.to_string();
    std::thread::spawn(move || {
        let settings = settings::load(&settings::default_settings_path()).unwrap_or_default();
        if let Err(err) = crate::terminal::open(&settings.integrations, &path) {
            emit_error(&app, "tray", format!("open terminal: {err}"));
        }
    });
}

pub fn handle_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if window.label() != WINDOW_LABEL {
        return;
    }

    if let WindowEvent::CloseRequested { api, .. } = event {
        let close_to_tray = settings::load(&settings::default_settings_path())
            .map(|settings| settings.desktop.close_to_tray)
            .unwrap_or(false);
        if !close_to_tray {
            return;
        }
        api.prevent_close();
        if let Err(err) = window.hide() {
            eprintln!("[tray] hide on close failed: {err}");
        }
    }
}

fn build_tray_menu<R: Runtime>(
    app: &AppHandle<R>,
    summary: Option<&GardenSummary>,
) -> tauri::Result<Menu<R>> {
    let status = MenuItem::with_id(
        app,
        MENU_STATUS,
        tray_status_label(summary),
        false,
        None::<&str>,
    )?;
    let top = build_top_projects_submenu(app, summary)?;
    let sep0 = PredefinedMenuItem::separator(app)?;
    let sep_top = PredefinedMenuItem::separator(app)?;
    let show = MenuItem::with_id(
        app,
        MENU_SHOW,
        tr("Show Garden", "显示庭院"),
        true,
        Some("CmdOrCtrl+Shift+G"),
    )?;
    let hide = MenuItem::with_id(
        app,
        MENU_HIDE,
        tr("Hide Window", "隐藏窗口"),
        true,
        Some("CmdOrCtrl+H"),
    )?;
    let scan = MenuItem::with_id(
        app,
        MENU_SCAN,
        tr("Scan Now", "立即扫描"),
        true,
        Some("CmdOrCtrl+R"),
    )?;
    let open_settings = MenuItem::with_id(
        app,
        MENU_OPEN_SETTINGS,
        tr("Open Settings", "打开设置"),
        true,
        None::<&str>,
    )?;
    let open_data_dir = MenuItem::with_id(
        app,
        MENU_OPEN_DATA_DIR,
        tr("Open Data Folder", "打开数据目录"),
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(
        app,
        MENU_QUIT,
        tr("Quit", "退出"),
        true,
        Some("CmdOrCtrl+Q"),
    )?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    Menu::with_items(
        app,
        &[
            &status,
            &sep0,
            &top,
            &sep_top,
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

/// Build the "Top Token Projects" submenu. Each row opens that project's root
/// in a terminal (id = `MENU_TERM_PREFIX` + path); a project without a known
/// path is shown disabled. Count is `integrations.tray_top_n`. Ranking is the
/// core `top_by_tokens` primitive — no leaderboard logic lives here.
fn build_top_projects_submenu<R: Runtime>(
    app: &AppHandle<R>,
    summary: Option<&GardenSummary>,
) -> tauri::Result<Submenu<R>> {
    let top_n = settings::load(&settings::default_settings_path())
        .map(|s| s.integrations.tray_top_n)
        .unwrap_or(5);

    let mut items: Vec<MenuItem<R>> = Vec::new();
    if let Some(summary) = summary {
        items.push(MenuItem::with_id(
            app,
            MENU_TODAY_TOKENS,
            format!(
                "{} {}",
                tr("Today", "今日"),
                fmt_tokens(today_tokens(summary))
            ),
            false,
            None::<&str>,
        )?);
        for (i, project) in top_by_tokens(summary, top_n).into_iter().enumerate() {
            let label = format!(
                "{} · {}",
                project.display_name,
                fmt_tokens(project.total_tokens)
            );
            match project.project_path.as_deref() {
                Some(path) if !path.is_empty() => {
                    let id = format!("{MENU_TERM_PREFIX}{path}");
                    items.push(MenuItem::with_id(app, id, label, true, None::<&str>)?);
                }
                // No known root → show it, but disabled (can't open a terminal).
                // Index keeps the id unique so the menu has no id collisions.
                _ => items.push(MenuItem::with_id(
                    app,
                    format!("garden-term-disabled-{i}"),
                    label,
                    false,
                    None::<&str>,
                )?),
            }
        }
    }
    if items.is_empty() {
        items.push(MenuItem::with_id(
            app,
            "garden-term-empty",
            "No token activity yet",
            false,
            None::<&str>,
        )?);
    }

    let refs: Vec<&dyn IsMenuItem<R>> = items.iter().map(|i| i as &dyn IsMenuItem<R>).collect();
    Submenu::with_items(app, tr("Top Token Projects", "Token 项目排行"), true, &refs)
}

/// The PRD P1-1 glance contract: say what happened, never lead with numbers.
/// Lantern state comes from core tiers (`lamp` stays live, not high-watered);
/// "new growth" is the count of ring events recorded today — the system-layer
/// equivalent of the frontend's seen-set diff, and already on disk.
fn tray_status_label(summary: Option<&GardenSummary>) -> String {
    let lit = summary
        .and_then(|summary| summary.tiers.as_ref())
        .map(|tiers| tiers.lamp == "lit")
        .unwrap_or(false);
    if !lit {
        return tr("Garden is quiet today", "庭院今日安静").to_string();
    }
    match today_ring_growth() {
        0 => tr(
            "🏮 Lantern lit · garden growing quietly",
            "🏮 灯已亮 · 庭院平静生长",
        )
        .to_string(),
        n if locale_is_zh() => format!("🏮 灯已亮 · {n} 处新生长"),
        n => format!("🏮 Lantern lit · {n} new growth"),
    }
}

/// Best-effort: a missing or unreadable rings file simply reads as "no new
/// growth" — the status line must never error over auxiliary memory.
fn today_ring_growth() -> usize {
    let key = utc_today_key();
    rings::load(&rings::default_rings_path())
        .map(|book| {
            book.events
                .iter()
                .filter(|event| event.utc_date == key)
                .count()
        })
        .unwrap_or(0)
}

fn utc_today_key() -> String {
    Utc::now().format("%Y-%m-%d").to_string()
}

fn today_tokens(summary: &GardenSummary) -> u64 {
    summary
        .daily_tokens
        .get(&utc_today_key())
        .copied()
        .unwrap_or(0)
}

/// Compact token count for menu labels (e.g. `213.4M`, `45.0k`). Display-only;
/// the canonical formatting also exists in the frontend `fmtLocal`.
fn fmt_tokens(tokens: u64) -> String {
    if tokens >= 1_000_000 {
        format!("{:.1}M", tokens as f64 / 1_000_000.0)
    } else if tokens >= 1_000 {
        format!("{:.1}k", tokens as f64 / 1_000.0)
    } else {
        tokens.to_string()
    }
}

fn build_control_submenu<R: Runtime>(app: &AppHandle<R>, title: &str) -> tauri::Result<Submenu<R>> {
    let show = MenuItem::with_id(
        app,
        MENU_SHOW,
        tr("Show Garden", "显示庭院"),
        true,
        Some("CmdOrCtrl+Shift+G"),
    )?;
    let hide = MenuItem::with_id(
        app,
        MENU_HIDE,
        tr("Hide Window", "隐藏窗口"),
        true,
        Some("CmdOrCtrl+H"),
    )?;
    let scan = MenuItem::with_id(
        app,
        MENU_SCAN,
        tr("Scan Now", "立即扫描"),
        true,
        Some("CmdOrCtrl+R"),
    )?;
    let open_settings = MenuItem::with_id(
        app,
        MENU_OPEN_SETTINGS,
        tr("Open Settings", "打开设置"),
        true,
        None::<&str>,
    )?;
    let open_data_dir = MenuItem::with_id(
        app,
        MENU_OPEN_DATA_DIR,
        tr("Open Data Folder", "打开数据目录"),
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(
        app,
        MENU_QUIT,
        tr("Quit", "退出"),
        true,
        Some("CmdOrCtrl+Q"),
    )?;
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
    let Some(window) = app.get_webview_window(WINDOW_LABEL) else {
        return;
    };
    if let Err(err) = window.hide() {
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
    if path.exists() {
        open_path(app, &path, "settings.toml");
        return;
    }
    if let Err(err) = settings::save(&path, &Settings::default()) {
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
