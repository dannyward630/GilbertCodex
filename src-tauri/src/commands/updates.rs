use std::sync::Mutex;

use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_updater::{Error as TauriUpdateError, Update, UpdaterExt};

#[derive(Default)]
pub struct AppUpdateState {
    pending: Mutex<Option<Update>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateCheckResponse {
    pub available: bool,
    pub body: Option<String>,
    pub current_version: String,
    pub date: Option<String>,
    pub feed_status: AppUpdateFeedStatus,
    pub message: Option<String>,
    pub target: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AppUpdateFeedStatus {
    Ready,
    Missing,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum AppUpdateInstallEvent {
    #[serde(rename = "started", rename_all = "camelCase")]
    Started { content_length: Option<u64> },
    #[serde(rename = "progress", rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
        content_length: Option<u64>,
        downloaded: u64,
    },
    #[serde(rename = "finished")]
    Finished,
}

#[tauri::command]
pub async fn app_update_check(
    app: AppHandle,
    update_state: State<'_, AppUpdateState>,
) -> Result<AppUpdateCheckResponse, String> {
    let current_version = app.package_info().version.to_string();
    let updater = app.updater().map_err(format_update_error)?;
    let update = match updater.check().await {
        Ok(update) => update,
        Err(TauriUpdateError::ReleaseNotFound) => {
            *update_state
                .pending
                .lock()
                .map_err(|_| "Update state lock was poisoned.".to_string())? = None;

            return Ok(AppUpdateCheckResponse {
                available: false,
                body: None,
                current_version,
                date: None,
                feed_status: AppUpdateFeedStatus::Missing,
                message: Some("No signed update feed is published yet. Publish a release with latest.json and signed updater artifacts before desktop installs can update automatically.".to_string()),
                target: None,
                version: None,
            });
        }
        Err(error) => return Err(format_update_error(error)),
    };

    let response = match update.as_ref() {
        Some(update) => AppUpdateCheckResponse {
            available: true,
            body: update.body.clone(),
            current_version: update.current_version.clone(),
            date: update.date.map(|date| date.to_string()),
            feed_status: AppUpdateFeedStatus::Ready,
            message: None,
            target: Some(update.target.clone()),
            version: Some(update.version.clone()),
        },
        None => AppUpdateCheckResponse {
            available: false,
            body: None,
            current_version,
            date: None,
            feed_status: AppUpdateFeedStatus::Ready,
            message: None,
            target: None,
            version: None,
        },
    };

    *update_state
        .pending
        .lock()
        .map_err(|_| "Update state lock was poisoned.".to_string())? = update;

    Ok(response)
}

#[tauri::command]
pub async fn app_update_install(
    app: AppHandle,
    update_state: State<'_, AppUpdateState>,
    on_event: Channel<AppUpdateInstallEvent>,
) -> Result<(), String> {
    let update = update_state
        .pending
        .lock()
        .map_err(|_| "Update state lock was poisoned.".to_string())?
        .take()
        .ok_or_else(|| {
            "No pending app update is available. Check for updates first.".to_string()
        })?;

    let mut downloaded = 0_u64;
    let mut started = false;

    update
        .download_and_install(
            |chunk_length, content_length| {
                if !started {
                    let _ = on_event.send(AppUpdateInstallEvent::Started { content_length });
                    started = true;
                }

                downloaded = downloaded.saturating_add(chunk_length as u64);
                let _ = on_event.send(AppUpdateInstallEvent::Progress {
                    chunk_length,
                    content_length,
                    downloaded,
                });
            },
            || {
                let _ = on_event.send(AppUpdateInstallEvent::Finished);
            },
        )
        .await
        .map_err(format_update_error)?;

    app.restart();
}

fn format_update_error(error: impl std::fmt::Display) -> String {
    format!("App update failed: {error}")
}
