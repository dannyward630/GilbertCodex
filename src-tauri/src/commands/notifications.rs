use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

const DESKTOP_NOTIFICATION_ACTIVATED_EVENT: &str = "desktop-notification-activated";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopNotificationRequest {
    title: String,
    body: String,
    chat_id: Option<String>,
    kind: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopNotificationActivationPayload {
    chat_id: Option<String>,
    kind: Option<String>,
}

#[tauri::command]
pub fn desktop_notification_show(
    app: AppHandle,
    request: DesktopNotificationRequest,
) -> Result<bool, String> {
    show_clickable_notification(app, request)
}

#[cfg(windows)]
fn show_clickable_notification(
    app: AppHandle,
    request: DesktopNotificationRequest,
) -> Result<bool, String> {
    use tauri_winrt_notification::{Duration, Toast};

    let (line1, line2) = split_notification_body(&request.body);
    let activation = DesktopNotificationActivationPayload {
        chat_id: request.chat_id.filter(|chat_id| !chat_id.trim().is_empty()),
        kind: normalize_notification_kind(request.kind),
    };
    let app_id = windows_notification_app_id(&app);
    let activation_app = app.clone();

    Toast::new(&app_id)
        .title(&request.title)
        .text1(&line1)
        .text2(&line2)
        .duration(Duration::Short)
        .on_activated(move |_| {
            activate_notification(&activation_app, activation.clone());
            Ok(())
        })
        .show()
        .map_err(|error| format!("Could not show clickable desktop notification: {error}"))?;

    Ok(true)
}

#[cfg(not(windows))]
fn show_clickable_notification(
    _app: AppHandle,
    _request: DesktopNotificationRequest,
) -> Result<bool, String> {
    Ok(false)
}

#[cfg(windows)]
fn windows_notification_app_id(app: &AppHandle) -> String {
    use std::path::MAIN_SEPARATOR as SEP;

    let identifier = app.config().identifier.clone();
    let Ok(exe) = tauri::utils::platform::current_exe() else {
        return identifier;
    };
    let Some(exe_dir) = exe.parent() else {
        return identifier;
    };

    let current_dir = exe_dir.display().to_string();
    if current_dir.ends_with(format!("{SEP}target{SEP}debug").as_str())
        || current_dir.ends_with(format!("{SEP}target{SEP}release").as_str())
    {
        tauri_winrt_notification::Toast::POWERSHELL_APP_ID.to_string()
    } else {
        identifier
    }
}

#[cfg(windows)]
fn split_notification_body(body: &str) -> (String, String) {
    let mut lines = body.lines().map(str::trim).filter(|line| !line.is_empty());
    let line1 = lines.next().unwrap_or("").to_string();
    let line2 = lines.collect::<Vec<_>>().join(" ");

    (line1, line2)
}

fn activate_notification(app: &AppHandle, activation: DesktopNotificationActivationPayload) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }

    let _ = app.emit(DESKTOP_NOTIFICATION_ACTIVATED_EVENT, activation);
}

fn normalize_notification_kind(kind: Option<String>) -> Option<String> {
    match kind.as_deref() {
        Some("completion" | "permission" | "question") => kind,
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notification_kind_rejects_unknown_values() {
        assert_eq!(
            normalize_notification_kind(Some("completion".to_string())),
            Some("completion".to_string())
        );
        assert_eq!(
            normalize_notification_kind(Some("unknown".to_string())),
            None
        );
        assert_eq!(normalize_notification_kind(None), None);
    }

    #[cfg(windows)]
    #[test]
    fn split_notification_body_keeps_first_line_prominent() {
        assert_eq!(
            split_notification_body(
                "Chat: Build\nCompleted: Finished the thing.\nClick to open this chat."
            ),
            (
                "Chat: Build".to_string(),
                "Completed: Finished the thing. Click to open this chat.".to_string()
            )
        );
    }
}
