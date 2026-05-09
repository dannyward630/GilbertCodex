use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub phase: String,
    pub runtime: String,
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        name: "Gilbert Codex".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        phase: "Phase 1".to_string(),
        runtime: "Tauri desktop".to_string(),
    }
}
