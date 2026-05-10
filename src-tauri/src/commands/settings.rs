use serde::Serialize;
use std::{
    env, fs,
    path::PathBuf,
    process::{Command, Stdio},
};

const WORKSPACE_DEPENDENCY_VERSION: &str = "26.430.10722";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserConfigInfo {
    pub exists: bool,
    pub has_deprecated_hooks_flag: bool,
    pub message: String,
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceDependencyDiagnostic {
    pub codex_version: Option<String>,
    pub details: Vec<String>,
    pub message: String,
    pub node_path: String,
    pub node_version: Option<String>,
    pub python_path: String,
    pub python_version: Option<String>,
    pub status: String,
    pub version: String,
}

#[tauri::command]
pub fn settings_get_user_config() -> Result<UserConfigInfo, String> {
    read_user_config_info()
}

#[tauri::command]
pub fn settings_open_user_config() -> Result<UserConfigInfo, String> {
    let path = user_config_path()?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create config directory: {error}"))?;
    }

    if !path.exists() {
        fs::write(
            &path,
            "# Codex user config\n# Enable hooks with: [features]\n# hooks = true\n",
        )
        .map_err(|error| format!("Could not create config.toml: {error}"))?;
    }

    open_file(&path)?;
    read_user_config_info()
}

#[tauri::command]
pub fn workspace_dependencies_diagnose() -> Result<WorkspaceDependencyDiagnostic, String> {
    Ok(create_workspace_dependency_diagnostic("diagnose"))
}

#[tauri::command]
pub fn workspace_dependencies_reinstall() -> Result<WorkspaceDependencyDiagnostic, String> {
    Ok(create_workspace_dependency_diagnostic("reinstall"))
}

fn read_user_config_info() -> Result<UserConfigInfo, String> {
    let path = user_config_path()?;
    let exists = path.exists();
    let content = if exists {
        fs::read_to_string(&path).unwrap_or_default()
    } else {
        String::new()
    };
    let has_deprecated_hooks_flag = content.contains("codex_hooks");
    let message = if has_deprecated_hooks_flag {
        "[features].codex_hooks is deprecated. Use [features].hooks instead.".to_string()
    } else if exists {
        "config.toml is ready.".to_string()
    } else {
        "config.toml has not been created yet.".to_string()
    };

    Ok(UserConfigInfo {
        exists,
        has_deprecated_hooks_flag,
        message,
        path: path.display().to_string(),
    })
}

fn create_workspace_dependency_diagnostic(action: &str) -> WorkspaceDependencyDiagnostic {
    let node_path = workspace_dependency_root()
        .join("node")
        .join("bin")
        .join(node_executable_name());
    let python_path = workspace_dependency_root()
        .join("python")
        .join(python_executable_name());
    let node_version = run_version(&node_path);
    let python_version = run_version(&python_path);
    let codex_version = run_program_version("codex");
    let mut details = Vec::new();

    details.push(format!("Bundle version: {WORKSPACE_DEPENDENCY_VERSION}"));
    details.push(format!("Node.js: {}", node_path.display()));
    details.push(format!("Python: {}", python_path.display()));

    if action == "reinstall" {
        details.push("Reset/install is managed by the Codex desktop runtime. Gilbert checked the current bundle without deleting host-managed files.".to_string());
    }

    let status = if node_version.is_some() && python_version.is_some() {
        "success"
    } else {
        "error"
    }
    .to_string();

    let message = if status == "success" {
        if action == "reinstall" {
            "Workspace dependencies are installed and available. No repair was needed.".to_string()
        } else {
            "Workspace dependency diagnostics passed.".to_string()
        }
    } else {
        "Workspace dependency diagnostics found a missing bundled runtime.".to_string()
    };

    WorkspaceDependencyDiagnostic {
        codex_version,
        details,
        message,
        node_path: node_path.display().to_string(),
        node_version,
        python_path: python_path.display().to_string(),
        python_version,
        status,
        version: WORKSPACE_DEPENDENCY_VERSION.to_string(),
    }
}

fn workspace_dependency_root() -> PathBuf {
    user_home()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".cache")
        .join("codex-runtimes")
        .join("codex-primary-runtime")
        .join("dependencies")
}

fn user_config_path() -> Result<PathBuf, String> {
    user_home()
        .map(|home| home.join(".codex").join("config.toml"))
        .ok_or_else(|| "Could not locate the user home folder.".to_string())
}

fn user_home() -> Option<PathBuf> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
}

fn node_executable_name() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

fn python_executable_name() -> &'static str {
    if cfg!(windows) {
        "python.exe"
    } else {
        "python"
    }
}

fn open_file(path: &PathBuf) -> Result<(), String> {
    let mut command = if cfg!(windows) {
        let mut command = Command::new("notepad");
        command.arg(path);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(path);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };

    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open config.toml: {error}"))
}

fn run_version(path: &PathBuf) -> Option<String> {
    if !path.exists() {
        return None;
    }

    run_command_version(Command::new(path).arg("--version"))
}

fn run_program_version(program: &str) -> Option<String> {
    run_command_version(Command::new(program).arg("--version"))
}

fn run_command_version(command: &mut Command) -> Option<String> {
    let output = command.stdin(Stdio::null()).output().ok()?;

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}
