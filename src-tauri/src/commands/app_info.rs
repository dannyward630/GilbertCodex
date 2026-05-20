use serde::Serialize;
use std::process::{Command, Stdio};

#[derive(Debug, Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub phase: String,
    pub runtime: String,
    pub platform: String,
    pub arch: String,
}

#[tauri::command]
pub fn get_app_info() -> AppInfo {
    AppInfo {
        name: "Gilbert Codex".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        phase: "Public alpha".to_string(),
        runtime: "Tauri desktop".to_string(),
        platform: host_platform().to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

fn host_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();

    if !is_allowed_external_url(trimmed) {
        return Err("Only http, https, and mailto links can be opened externally.".to_string());
    }

    let mut command = if cfg!(windows) {
        let mut command = Command::new("rundll32.exe");
        command.args(["url.dll,FileProtocolHandler", trimmed]);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(trimmed);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(trimmed);
        command
    };

    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open link in the default browser: {error}"))
}

fn is_allowed_external_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_url_validation_allows_browser_protocols() {
        assert!(is_allowed_external_url("https://example.com"));
        assert!(is_allowed_external_url("http://localhost:4173/"));
        assert!(is_allowed_external_url("mailto:test@example.com"));
    }

    #[test]
    fn external_url_validation_rejects_local_or_script_protocols() {
        assert!(!is_allowed_external_url("javascript:alert(1)"));
        assert!(!is_allowed_external_url(
            "file:///C:/Users/Kobe/secrets.txt"
        ));
        assert!(!is_allowed_external_url(""));
    }
}
