use serde::{Deserialize, Serialize};
use std::ffi::{OsStr, OsString};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub enum ProjectOpenTarget {
    #[serde(rename = "android-studio")]
    AndroidStudio,
    #[serde(rename = "claude-code")]
    ClaudeCode,
    #[serde(rename = "cursor")]
    Cursor,
    #[serde(rename = "file-manager")]
    FileManager,
    #[serde(rename = "git-bash")]
    GitBash,
    #[serde(rename = "intellij-idea")]
    IntellijIdea,
    #[serde(rename = "pycharm")]
    PyCharm,
    #[serde(rename = "terminal")]
    Terminal,
    #[serde(rename = "visual-studio")]
    VisualStudio,
    #[serde(rename = "vscode")]
    VsCode,
    #[serde(rename = "webstorm")]
    WebStorm,
    #[serde(rename = "windsurf")]
    Windsurf,
    #[serde(rename = "wsl")]
    Wsl,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectOpenRequest {
    pub path: String,
    pub target: ProjectOpenTarget,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectOpenResponse {
    pub message: String,
    pub path: String,
    pub target: ProjectOpenTarget,
    pub target_label: String,
}

#[derive(Clone, Debug)]
struct LaunchCandidate {
    args: Vec<OsString>,
    program: OsString,
}

#[tauri::command]
pub fn project_open_external_tool(
    request: ProjectOpenRequest,
) -> Result<ProjectOpenResponse, String> {
    let project_path = resolve_project_directory(&request.path)?;
    let target_label = target_label(request.target).to_string();

    launch_project_target(request.target, &project_path)?;

    Ok(ProjectOpenResponse {
        message: format!(
            "Opening {} in {}.",
            display_path_for_user(&project_path),
            target_label
        ),
        path: display_path_for_user(&project_path),
        target: request.target,
        target_label,
    })
}

fn resolve_project_directory(raw_path: &str) -> Result<PathBuf, String> {
    let trimmed = raw_path.trim();

    if trimmed.is_empty() {
        return Err("Choose a project folder before opening it in another app.".to_string());
    }

    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("Project folders must use an absolute local path.".to_string());
    }

    let canonical = fs::canonicalize(&path)
        .map_err(|error| format!("Could not read project folder: {error}"))?;
    let metadata = fs::metadata(&canonical)
        .map_err(|error| format!("Could not inspect project folder: {error}"))?;

    if !metadata.is_dir() {
        return Err("Choose a folder, not an individual file.".to_string());
    }

    Ok(canonical)
}

fn launch_project_target(target: ProjectOpenTarget, path: &Path) -> Result<(), String> {
    match target {
        ProjectOpenTarget::AndroidStudio => {
            launch_first_available(target_label(target), android_studio_candidates(path))
        }
        ProjectOpenTarget::ClaudeCode => {
            launch_first_available(target_label(target), claude_code_candidates(path))
        }
        ProjectOpenTarget::Cursor => {
            launch_first_available(target_label(target), cursor_candidates(path))
        }
        ProjectOpenTarget::FileManager => {
            launch_first_available(target_label(target), file_manager_candidates(path))
        }
        ProjectOpenTarget::GitBash => {
            launch_first_available(target_label(target), git_bash_candidates(path))
        }
        ProjectOpenTarget::IntellijIdea => {
            launch_first_available(target_label(target), intellij_candidates(path))
        }
        ProjectOpenTarget::PyCharm => {
            launch_first_available(target_label(target), pycharm_candidates(path))
        }
        ProjectOpenTarget::Terminal => {
            launch_first_available(target_label(target), terminal_candidates(path))
        }
        ProjectOpenTarget::VisualStudio => {
            launch_first_available(target_label(target), visual_studio_candidates(path))
        }
        ProjectOpenTarget::VsCode => {
            launch_first_available(target_label(target), vscode_candidates(path))
        }
        ProjectOpenTarget::WebStorm => {
            launch_first_available(target_label(target), webstorm_candidates(path))
        }
        ProjectOpenTarget::Windsurf => {
            launch_first_available(target_label(target), windsurf_candidates(path))
        }
        ProjectOpenTarget::Wsl => {
            launch_first_available(target_label(target), wsl_candidates(path))
        }
    }
}

fn launch_first_available(label: &str, candidates: Vec<LaunchCandidate>) -> Result<(), String> {
    if candidates.is_empty() {
        return Err(format!(
            "Could not find a launcher for {label}. Make sure it is installed."
        ));
    }

    let mut tried = Vec::new();
    for candidate in candidates {
        let program_label = candidate.program.to_string_lossy().to_string();
        let mut command = Command::new(&candidate.program);
        command
            .args(&candidate.args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        match command.spawn() {
            Ok(_) => return Ok(()),
            Err(error) => tried.push(format!("{program_label} ({error})")),
        }
    }

    Err(format!(
        "Could not open project in {label}. Install it or add its launcher to PATH. Tried: {}",
        tried.join("; ")
    ))
}

fn target_label(target: ProjectOpenTarget) -> &'static str {
    match target {
        ProjectOpenTarget::AndroidStudio => "Android Studio",
        ProjectOpenTarget::ClaudeCode => "Claude Code",
        ProjectOpenTarget::Cursor => "Cursor",
        ProjectOpenTarget::FileManager => {
            if cfg!(windows) {
                "File Explorer"
            } else if cfg!(target_os = "macos") {
                "Finder"
            } else {
                "file manager"
            }
        }
        ProjectOpenTarget::GitBash => "Git Bash",
        ProjectOpenTarget::IntellijIdea => "IntelliJ IDEA",
        ProjectOpenTarget::PyCharm => "PyCharm",
        ProjectOpenTarget::Terminal => "Terminal",
        ProjectOpenTarget::VisualStudio => "Visual Studio",
        ProjectOpenTarget::VsCode => "VS Code",
        ProjectOpenTarget::WebStorm => "WebStorm",
        ProjectOpenTarget::Windsurf => "Windsurf",
        ProjectOpenTarget::Wsl => "WSL",
    }
}

fn vscode_candidates(path: &Path) -> Vec<LaunchCandidate> {
    platform_candidates(
        path,
        &[
            WindowsPathCandidate::local_app_data(&["Programs", "Microsoft VS Code", "Code.exe"]),
            WindowsPathCandidate::program_files(&["Microsoft VS Code", "Code.exe"]),
            WindowsPathCandidate::local_app_data(&[
                "Programs",
                "Microsoft VS Code Insiders",
                "Code - Insiders.exe",
            ]),
            WindowsPathCandidate::program_files(&[
                "Microsoft VS Code Insiders",
                "Code - Insiders.exe",
            ]),
        ],
        &["code", "code-insiders"],
        &["Visual Studio Code", "Visual Studio Code - Insiders"],
        &["code", "code-insiders"],
    )
}

fn cursor_candidates(path: &Path) -> Vec<LaunchCandidate> {
    platform_candidates(
        path,
        &[
            WindowsPathCandidate::local_app_data(&["Programs", "Cursor", "Cursor.exe"]),
            WindowsPathCandidate::local_app_data(&["Programs", "cursor", "Cursor.exe"]),
            WindowsPathCandidate::program_files(&["Cursor", "Cursor.exe"]),
        ],
        &["cursor"],
        &["Cursor"],
        &["cursor"],
    )
}

fn windsurf_candidates(path: &Path) -> Vec<LaunchCandidate> {
    platform_candidates(
        path,
        &[
            WindowsPathCandidate::local_app_data(&["Programs", "Windsurf", "Windsurf.exe"]),
            WindowsPathCandidate::program_files(&["Windsurf", "Windsurf.exe"]),
        ],
        &["windsurf"],
        &["Windsurf"],
        &["windsurf"],
    )
}

fn android_studio_candidates(path: &Path) -> Vec<LaunchCandidate> {
    platform_candidates(
        path,
        &[
            WindowsPathCandidate::program_files(&[
                "Android",
                "Android Studio",
                "bin",
                "studio64.exe",
            ]),
            WindowsPathCandidate::program_files(&[
                "Android",
                "Android Studio",
                "bin",
                "studio.exe",
            ]),
            WindowsPathCandidate::local_app_data(&[
                "Programs",
                "Android Studio",
                "bin",
                "studio64.exe",
            ]),
        ],
        &["studio64.exe", "studio.exe", "studio"],
        &["Android Studio"],
        &["android-studio", "studio.sh", "studio"],
    )
}

fn intellij_candidates(path: &Path) -> Vec<LaunchCandidate> {
    let mut candidates =
        jetbrains_windows_candidates(path, &["IntelliJ IDEA"], &["idea64.exe", "idea.exe"]);
    candidates.extend(platform_candidates(
        path,
        &[],
        &["idea64.exe", "idea.exe", "idea"],
        &["IntelliJ IDEA", "IntelliJ IDEA CE"],
        &["idea", "idea.sh"],
    ));
    candidates
}

fn webstorm_candidates(path: &Path) -> Vec<LaunchCandidate> {
    let mut candidates =
        jetbrains_windows_candidates(path, &["WebStorm"], &["webstorm64.exe", "webstorm.exe"]);
    candidates.extend(platform_candidates(
        path,
        &[],
        &["webstorm64.exe", "webstorm.exe", "webstorm"],
        &["WebStorm"],
        &["webstorm", "webstorm.sh"],
    ));
    candidates
}

fn pycharm_candidates(path: &Path) -> Vec<LaunchCandidate> {
    let mut candidates =
        jetbrains_windows_candidates(path, &["PyCharm"], &["pycharm64.exe", "pycharm.exe"]);
    candidates.extend(platform_candidates(
        path,
        &[],
        &["pycharm64.exe", "pycharm.exe", "pycharm"],
        &["PyCharm"],
        &["pycharm", "pycharm.sh"],
    ));
    candidates
}

fn visual_studio_candidates(path: &Path) -> Vec<LaunchCandidate> {
    let mut candidates = Vec::new();

    if cfg!(windows) {
        for year in ["2022", "2019"] {
            for edition in ["Community", "Professional", "Enterprise", "BuildTools"] {
                if let Some(candidate) = windows_env_path_candidate(
                    "ProgramFiles",
                    &[
                        "Microsoft Visual Studio",
                        year,
                        edition,
                        "Common7",
                        "IDE",
                        "devenv.exe",
                    ],
                    path,
                ) {
                    candidates.push(candidate);
                }
            }
        }
        candidates.push(command_candidate("devenv.exe", path_args(path)));
    } else if cfg!(target_os = "macos") {
        candidates.push(command_candidate(
            "open",
            open_app_args("Visual Studio", path),
        ));
    } else {
        candidates.push(command_candidate("devenv", path_args(path)));
    }

    candidates
}

fn file_manager_candidates(path: &Path) -> Vec<LaunchCandidate> {
    if cfg!(windows) {
        vec![command_candidate("explorer.exe", path_args(path))]
    } else if cfg!(target_os = "macos") {
        vec![command_candidate("open", path_args(path))]
    } else {
        vec![command_candidate("xdg-open", path_args(path))]
    }
}

fn terminal_candidates(path: &Path) -> Vec<LaunchCandidate> {
    if cfg!(windows) {
        vec![
            command_candidate("wt.exe", vec![OsString::from("-d"), path_arg(path)]),
            command_candidate(
                "powershell.exe",
                vec![
                    OsString::from("-NoLogo"),
                    OsString::from("-NoExit"),
                    OsString::from("-Command"),
                    OsString::from(format!(
                        "Set-Location -LiteralPath {}",
                        powershell_single_quoted_path(path)
                    )),
                ],
            ),
            command_candidate(
                "cmd.exe",
                vec![
                    OsString::from("/K"),
                    OsString::from(format!("cd /d {}", cmd_quoted_path(path))),
                ],
            ),
        ]
    } else if cfg!(target_os = "macos") {
        vec![command_candidate(
            "osascript",
            vec![
                OsString::from("-e"),
                OsString::from(format!(
                    "tell application \"Terminal\" to do script \"cd {}\"",
                    sh_single_quoted_path(path)
                )),
                OsString::from("-e"),
                OsString::from("tell application \"Terminal\" to activate"),
            ],
        )]
    } else {
        vec![
            command_candidate(
                "gnome-terminal",
                vec![OsString::from("--working-directory"), path_arg(path)],
            ),
            command_candidate(
                "x-terminal-emulator",
                vec![
                    OsString::from("-e"),
                    OsString::from("sh"),
                    OsString::from("-lc"),
                    OsString::from(format!("cd {}; exec sh", sh_single_quoted_path(path))),
                ],
            ),
        ]
    }
}

fn git_bash_candidates(path: &Path) -> Vec<LaunchCandidate> {
    if cfg!(windows) {
        let mut candidates = Vec::new();

        for env_var in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
            if let Some(candidate) =
                windows_env_git_bash_candidate(env_var, &["Git", "git-bash.exe"], path)
            {
                candidates.push(candidate);
            }
        }

        candidates.push(command_candidate("git-bash.exe", git_bash_args(path)));
        candidates
    } else {
        vec![
            command_candidate(
                "gnome-terminal",
                vec![
                    OsString::from("--working-directory"),
                    path_arg(path),
                    OsString::from("--"),
                    OsString::from("bash"),
                    OsString::from("--login"),
                    OsString::from("-i"),
                ],
            ),
            command_candidate(
                "x-terminal-emulator",
                vec![
                    OsString::from("-e"),
                    OsString::from("bash"),
                    OsString::from("-lc"),
                    OsString::from(format!("cd {}; exec bash -l", sh_single_quoted_path(path))),
                ],
            ),
        ]
    }
}

fn wsl_candidates(path: &Path) -> Vec<LaunchCandidate> {
    if cfg!(windows) {
        vec![
            command_candidate(
                "wt.exe",
                vec![
                    OsString::from("wsl.exe"),
                    OsString::from("--cd"),
                    path_arg(path),
                ],
            ),
            command_candidate(
                "powershell.exe",
                vec![
                    OsString::from("-NoLogo"),
                    OsString::from("-NoExit"),
                    OsString::from("-Command"),
                    OsString::from(format!(
                        "wsl.exe --cd {}",
                        powershell_single_quoted_path(path)
                    )),
                ],
            ),
            command_candidate("wsl.exe", vec![OsString::from("--cd"), path_arg(path)]),
        ]
    } else {
        Vec::new()
    }
}

fn claude_code_candidates(path: &Path) -> Vec<LaunchCandidate> {
    if cfg!(windows) {
        vec![
            command_candidate(
                "wt.exe",
                vec![
                    OsString::from("-d"),
                    path_arg(path),
                    OsString::from("powershell.exe"),
                    OsString::from("-NoLogo"),
                    OsString::from("-NoExit"),
                    OsString::from("-Command"),
                    OsString::from("claude"),
                ],
            ),
            command_candidate(
                "powershell.exe",
                vec![
                    OsString::from("-NoLogo"),
                    OsString::from("-NoExit"),
                    OsString::from("-Command"),
                    OsString::from(format!(
                        "Set-Location -LiteralPath {}; claude",
                        powershell_single_quoted_path(path)
                    )),
                ],
            ),
        ]
    } else if cfg!(target_os = "macos") {
        vec![command_candidate(
            "osascript",
            vec![
                OsString::from("-e"),
                OsString::from(format!(
                    "tell application \"Terminal\" to do script \"cd {} && claude\"",
                    sh_single_quoted_path(path)
                )),
                OsString::from("-e"),
                OsString::from("tell application \"Terminal\" to activate"),
            ],
        )]
    } else {
        let script = format!("cd {} && claude; exec sh", sh_single_quoted_path(path));
        vec![
            command_candidate(
                "x-terminal-emulator",
                vec![
                    OsString::from("-e"),
                    OsString::from("sh"),
                    OsString::from("-lc"),
                    OsString::from(script.clone()),
                ],
            ),
            command_candidate(
                "gnome-terminal",
                vec![
                    OsString::from("--working-directory"),
                    path_arg(path),
                    OsString::from("--"),
                    OsString::from("sh"),
                    OsString::from("-lc"),
                    OsString::from(script),
                ],
            ),
        ]
    }
}

fn platform_candidates(
    path: &Path,
    windows_paths: &[WindowsPathCandidate],
    windows_commands: &[&str],
    mac_apps: &[&str],
    unix_commands: &[&str],
) -> Vec<LaunchCandidate> {
    let mut candidates = Vec::new();

    if cfg!(windows) {
        for candidate in windows_paths {
            if let Some(path_candidate) = candidate.to_launch_candidate(path) {
                candidates.push(path_candidate);
            }
        }

        for command in windows_commands {
            candidates.push(command_candidate(*command, path_args(path)));
        }
    } else if cfg!(target_os = "macos") {
        for app in mac_apps {
            candidates.push(command_candidate("open", open_app_args(app, path)));
        }

        for command in unix_commands {
            candidates.push(command_candidate(*command, path_args(path)));
        }
    } else {
        for command in unix_commands {
            candidates.push(command_candidate(*command, path_args(path)));
        }
    }

    candidates
}

fn jetbrains_windows_candidates(
    path: &Path,
    app_prefixes: &[&str],
    exe_names: &[&str],
) -> Vec<LaunchCandidate> {
    if !cfg!(windows) {
        return Vec::new();
    }

    let mut candidates = Vec::new();
    for root_var in ["ProgramFiles", "ProgramFiles(x86)"] {
        let Some(root) = std::env::var_os(root_var) else {
            continue;
        };
        let jetbrains_dir = PathBuf::from(root).join("JetBrains");
        let Ok(entries) = fs::read_dir(jetbrains_dir) else {
            continue;
        };

        for entry in entries.flatten() {
            let app_dir = entry.path();
            let Some(name) = app_dir.file_name().and_then(OsStr::to_str) else {
                continue;
            };

            if !app_prefixes.iter().any(|prefix| name.starts_with(prefix)) {
                continue;
            }

            for exe_name in exe_names {
                let exe_path = app_dir.join("bin").join(exe_name);
                if exe_path.exists() {
                    candidates.push(command_candidate(
                        exe_path.into_os_string(),
                        path_args(path),
                    ));
                }
            }
        }
    }

    candidates
}

#[derive(Clone, Copy, Debug)]
struct WindowsPathCandidate {
    env_var: &'static str,
    parts: &'static [&'static str],
}

impl WindowsPathCandidate {
    const fn local_app_data(parts: &'static [&'static str]) -> Self {
        Self {
            env_var: "LOCALAPPDATA",
            parts,
        }
    }

    const fn program_files(parts: &'static [&'static str]) -> Self {
        Self {
            env_var: "ProgramFiles",
            parts,
        }
    }

    fn to_launch_candidate(self, project_path: &Path) -> Option<LaunchCandidate> {
        windows_env_path_candidate(self.env_var, self.parts, project_path)
    }
}

fn windows_env_path_candidate(
    env_var: &str,
    parts: &[&str],
    project_path: &Path,
) -> Option<LaunchCandidate> {
    let mut executable = PathBuf::from(std::env::var_os(env_var)?);

    for part in parts {
        executable.push(part);
    }

    executable
        .exists()
        .then(|| command_candidate(executable.into_os_string(), path_args(project_path)))
}

fn windows_env_git_bash_candidate(
    env_var: &str,
    parts: &[&str],
    project_path: &Path,
) -> Option<LaunchCandidate> {
    let mut executable = PathBuf::from(std::env::var_os(env_var)?);

    for part in parts {
        executable.push(part);
    }

    executable
        .exists()
        .then(|| command_candidate(executable.into_os_string(), git_bash_args(project_path)))
}

fn command_candidate(program: impl Into<OsString>, args: Vec<OsString>) -> LaunchCandidate {
    LaunchCandidate {
        args,
        program: program.into(),
    }
}

fn open_app_args(app_name: &str, path: &Path) -> Vec<OsString> {
    vec![
        OsString::from("-a"),
        OsString::from(app_name),
        path_arg(path),
    ]
}

fn path_args(path: &Path) -> Vec<OsString> {
    vec![path_arg(path)]
}

fn git_bash_args(path: &Path) -> Vec<OsString> {
    vec![OsString::from(format!(
        "--cd={}",
        display_path_for_user(path)
    ))]
}

fn path_arg(path: &Path) -> OsString {
    OsString::from(display_path_for_user(path))
}

fn display_path_for_user(path: &Path) -> String {
    let raw = path.display().to_string();

    if cfg!(windows) {
        if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{stripped}");
        }

        if let Some(stripped) = raw.strip_prefix(r"\\?\") {
            return stripped.to_string();
        }
    }

    raw
}

fn powershell_single_quoted_path(path: &Path) -> String {
    format!("'{}'", display_path_for_user(path).replace('\'', "''"))
}

fn cmd_quoted_path(path: &Path) -> String {
    format!("\"{}\"", display_path_for_user(path).replace('"', "\"\""))
}

fn sh_single_quoted_path(path: &Path) -> String {
    let raw = display_path_for_user(path);
    sh_single_quoted_raw(&raw)
}

fn sh_single_quoted_raw(raw: &str) -> String {
    format!("'{}'", raw.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_open_target_labels_are_user_facing() {
        assert_eq!(target_label(ProjectOpenTarget::VsCode), "VS Code");
        assert_eq!(target_label(ProjectOpenTarget::ClaudeCode), "Claude Code");
        assert_eq!(target_label(ProjectOpenTarget::GitBash), "Git Bash");
        assert_eq!(target_label(ProjectOpenTarget::Terminal), "Terminal");
        assert_eq!(target_label(ProjectOpenTarget::Wsl), "WSL");
        assert_eq!(
            target_label(ProjectOpenTarget::AndroidStudio),
            "Android Studio"
        );
    }

    #[test]
    fn shell_quotes_paths_with_single_quotes() {
        let path = Path::new("C:/Users/Example User/it's here");

        assert_eq!(
            powershell_single_quoted_path(path),
            "'C:/Users/Example User/it''s here'"
        );
        assert_eq!(
            sh_single_quoted_path(path),
            "'C:/Users/Example User/it'\\''s here'"
        );
    }
}
