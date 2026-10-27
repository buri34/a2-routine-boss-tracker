use chrono::Local;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
#[cfg(not(target_os = "windows"))]
use tauri_plugin_notification::NotificationExt;

const STATE_FILE: &str = "state.json";

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("データ保存先を取得できません: {error}"))?;
    Ok(directory.join(STATE_FILE))
}

fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "保存先フォルダーを取得できません".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("保存先を作成できません: {error}"))?;
    let temporary = path.with_extension("json.tmp");
    let backup = path.with_extension("json.bak");
    fs::write(&temporary, contents).map_err(|error| format!("一時保存に失敗しました: {error}"))?;
    if path.exists() {
        if backup.exists() {
            fs::remove_file(&backup)
                .map_err(|error| format!("旧バックアップを更新できません: {error}"))?;
        }
        fs::rename(path, &backup).map_err(|error| format!("旧データを退避できません: {error}"))?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if backup.exists() {
            let _ = fs::rename(&backup, path);
        }
        return Err(format!("保存データを確定できません: {error}"));
    }
    Ok(())
}

#[tauri::command]
fn load_state(app: AppHandle) -> Result<Option<String>, String> {
    let path = state_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("保存データを読み込めません: {error}"))?;
    if let Err(error) = serde_json::from_str::<serde_json::Value>(&contents) {
        let corrupt = path.with_extension(format!(
            "corrupt-{}.json",
            Local::now().format("%Y%m%d-%H%M%S")
        ));
        fs::rename(&path, &corrupt)
            .map_err(|move_error| format!("壊れたデータを退避できません: {move_error}"))?;
        return Err(format!(
            "保存データが壊れていたため {} へ退避しました: {error}",
            corrupt.to_string_lossy()
        ));
    }
    Ok(Some(contents))
}

#[tauri::command]
fn save_state(app: AppHandle, json: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|error| format!("保存データのJSONが不正です: {error}"))?;
    atomic_write(&state_path(&app)?, json.as_bytes())
}

#[tauri::command]
fn export_backup(app: AppHandle, json: String) -> Result<String, String> {
    serde_json::from_str::<serde_json::Value>(&json)
        .map_err(|error| format!("バックアップのJSONが不正です: {error}"))?;
    let download_dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().document_dir())
        .map_err(|error| format!("バックアップ先を取得できません: {error}"))?;
    let filename = format!(
        "A2RoutineBossTracker-backup-{}.json",
        Local::now().format("%Y%m%d-%H%M%S")
    );
    let path = download_dir.join(filename);
    atomic_write(&path, json.as_bytes())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(target_os = "windows")]
#[tauri::command]
fn send_notification(_app: AppHandle, title: String, body: String) -> Result<String, String> {
    notify_rust::Notification::new()
        .summary(&title)
        .body(&body)
        .show()
        .map_err(|error| format!("Windows通知を送れません: {error}"))?;
    Ok("テスト通知を送りました".to_string())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn send_notification(app: AppHandle, title: String, body: String) -> Result<String, String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| format!("通知を送れません: {error}"))?;
    Ok("テスト通知を送りました".to_string())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            export_backup,
            send_notification
        ])
        .setup(|app| {
            let show = MenuItem::with_id(
                app,
                "show",
                "A2 ルーティン&ボストラッカーを表示",
                true,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(app, "quit", "完全に終了", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main").menu(&menu);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.on_menu_event(|app, event| match event.id.as_ref() {
                "show" => show_main_window(app),
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    show_main_window(tray.app_handle());
                }
            })
            .build(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("A2 ルーティン&ボストラッカーの起動に失敗しました");

    app.run(|app, event| {
        if let RunEvent::WindowEvent {
            label,
            event: WindowEvent::CloseRequested { api, .. },
            ..
        } = event
        {
            if label == "main" {
                api.prevent_close();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::atomic_write;
    use std::fs;

    #[test]
    fn atomic_write_creates_and_replaces_valid_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.json");
        atomic_write(&path, br#"{"version":1}"#).unwrap();
        atomic_write(&path, br#"{"version":2}"#).unwrap();
        assert_eq!(fs::read_to_string(path).unwrap(), r#"{"version":2}"#);
        assert_eq!(
            fs::read_to_string(directory.path().join("state.json.bak")).unwrap(),
            r#"{"version":1}"#
        );
    }
}
