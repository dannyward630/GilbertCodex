use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_BUFFERED_CHUNKS: usize = 1_500;
const MAX_CHUNK_BYTES: usize = 64 * 1024;

#[derive(Default)]
pub struct TerminalState {
    sessions: Mutex<HashMap<String, TerminalSession>>,
    next_id: AtomicU64,
}

struct TerminalSession {
    active_child: Option<Child>,
    active_command: Option<String>,
    exited: Option<i32>,
    output: Arc<Mutex<VecDeque<TerminalOutputChunk>>>,
    shell: TerminalShell,
    working_directory: PathBuf,
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        if let Some(child) = self.active_child.as_mut() {
            let _ = child.kill();
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreateSessionRequest {
    pub shell: Option<TerminalShell>,
    pub working_directory: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWriteSessionRequest {
    pub input: String,
    pub session_id: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionRequest {
    pub session_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreateSessionResponse {
    pub initial_output: Vec<TerminalOutputChunk>,
    pub session_id: String,
    pub shell: TerminalShell,
    pub started_at: u64,
    pub working_directory: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDrainResponse {
    pub chunks: Vec<TerminalOutputChunk>,
    pub exit_code: Option<i32>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub enum TerminalShell {
    #[serde(rename = "powershell")]
    PowerShell,
    #[serde(rename = "cmd")]
    Cmd,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputChunk {
    pub id: String,
    pub stream: TerminalOutputStream,
    pub text: String,
    pub timestamp: u64,
}

#[derive(Clone, Debug, Serialize)]
pub enum TerminalOutputStream {
    #[serde(rename = "stderr")]
    Stderr,
    #[serde(rename = "stdout")]
    Stdout,
    #[serde(rename = "system")]
    System,
}

#[tauri::command]
pub fn terminal_create_session(
    state: tauri::State<'_, TerminalState>,
    request: TerminalCreateSessionRequest,
) -> Result<TerminalCreateSessionResponse, String> {
    let shell = request.shell.unwrap_or(TerminalShell::PowerShell);
    let working_directory = resolve_working_directory(request.working_directory)?;
    let output = Arc::new(Mutex::new(VecDeque::new()));

    push_output(
        &output,
        TerminalOutputStream::System,
        format!(
            "Started {} command sandbox in {}\n",
            shell_label(&shell),
            path_to_string(&working_directory)
        ),
    );
    push_output(
        &output,
        TerminalOutputStream::System,
        "Commands run as local child processes and can change files or install project dependencies.\n".to_string(),
    );

    let session_id = format!(
        "terminal-{}",
        state.next_id.fetch_add(1, Ordering::Relaxed) + 1
    );
    let session = TerminalSession {
        active_child: None,
        active_command: None,
        exited: None,
        output: Arc::clone(&output),
        shell,
        working_directory,
    };
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "The terminal session registry is busy. Try again in a moment.".to_string())?;
    let response = TerminalCreateSessionResponse {
        initial_output: drain_output(&output),
        session_id: session_id.clone(),
        shell: session.shell.clone(),
        started_at: now_millis(),
        working_directory: path_to_string(&session.working_directory),
    };

    sessions.insert(session_id, session);

    Ok(response)
}

#[tauri::command]
pub fn terminal_write_session(
    state: tauri::State<'_, TerminalState>,
    request: TerminalWriteSessionRequest,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "The terminal session registry is busy. Try again in a moment.".to_string())?;
    let session = sessions
        .get_mut(&request.session_id)
        .ok_or_else(|| "That terminal session is no longer available.".to_string())?;

    refresh_active_command(session)?;

    if session.exited.is_some() {
        return Err("That terminal session has already exited. Start a new session.".to_string());
    }

    if session.active_child.is_some() {
        return Err(
            "A command is already running in this terminal. Stop it or wait for it to finish."
                .to_string(),
        );
    }

    let input = request.input.trim();

    if input.is_empty() {
        return Ok(());
    }

    if input.eq_ignore_ascii_case("exit") {
        session.exited = Some(0);
        push_output(
            &session.output,
            TerminalOutputStream::System,
            "Terminal session exited.\n".to_string(),
        );
        return Ok(());
    }

    if let Some(next_directory) = parse_change_directory(input, &session.working_directory) {
        match resolve_working_directory(Some(path_to_string(next_directory))) {
            Ok(path) => {
                session.working_directory = path;
                push_output(
                    &session.output,
                    TerminalOutputStream::System,
                    format!(
                        "Working directory: {}\n",
                        path_to_string(&session.working_directory)
                    ),
                );
            }
            Err(error) => push_output(
                &session.output,
                TerminalOutputStream::Stderr,
                format!("{error}\n"),
            ),
        }

        return Ok(());
    }

    let mut command = create_shell_command(&session.shell, input);

    command
        .current_dir(&session.working_directory)
        .env("GILBERT_CODEX_TERMINAL", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| {
        format!(
            "Could not run {} command: {}",
            shell_label(&session.shell),
            error
        )
    })?;

    if let Some(stdout) = child.stdout.take() {
        read_terminal_stream(
            stdout,
            TerminalOutputStream::Stdout,
            Arc::clone(&session.output),
        );
    }

    if let Some(stderr) = child.stderr.take() {
        read_terminal_stream(
            stderr,
            TerminalOutputStream::Stderr,
            Arc::clone(&session.output),
        );
    }

    session.active_child = Some(child);
    session.active_command = Some(input.to_string());

    Ok(())
}

#[tauri::command]
pub fn terminal_drain_session(
    state: tauri::State<'_, TerminalState>,
    request: TerminalSessionRequest,
) -> Result<TerminalDrainResponse, String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "The terminal session registry is busy. Try again in a moment.".to_string())?;
    let session = sessions
        .get_mut(&request.session_id)
        .ok_or_else(|| "That terminal session is no longer available.".to_string())?;

    refresh_active_command(session)?;

    Ok(TerminalDrainResponse {
        chunks: drain_output(&session.output),
        exit_code: session.exited,
    })
}

#[tauri::command]
pub fn terminal_kill_session(
    state: tauri::State<'_, TerminalState>,
    request: TerminalSessionRequest,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "The terminal session registry is busy. Try again in a moment.".to_string())?;

    sessions
        .remove(&request.session_id)
        .map(|mut session| {
            if let Some(child) = session.active_child.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
        })
        .ok_or_else(|| "That terminal session is already closed.".to_string())
}

fn refresh_active_command(session: &mut TerminalSession) -> Result<(), String> {
    let exit_status = match session.active_child.as_mut() {
        Some(child) => child
            .try_wait()
            .map_err(|error| format!("Could not inspect terminal command: {}", error))?,
        None => None,
    };

    if let Some(status) = exit_status {
        session.active_child.take();
        let command = session
            .active_command
            .take()
            .unwrap_or_else(|| "command".to_string());

        match status.code() {
            Some(0) => push_output(
                &session.output,
                TerminalOutputStream::System,
                format!("Command finished: {command}\n"),
            ),
            Some(code) => push_output(
                &session.output,
                TerminalOutputStream::System,
                format!("Command exited with code {code}: {command}\n"),
            ),
            None => push_output(
                &session.output,
                TerminalOutputStream::System,
                format!("Command stopped: {command}\n"),
            ),
        }
    }

    Ok(())
}

fn create_shell_command(shell: &TerminalShell, input: &str) -> Command {
    #[cfg(windows)]
    {
        match shell {
            TerminalShell::PowerShell => {
                let mut command = Command::new("powershell.exe");
                command.args([
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    input,
                ]);
                command
            }
            TerminalShell::Cmd => {
                let mut command = Command::new("cmd.exe");
                command.args(["/Q", "/C", input]);
                command
            }
        }
    }

    #[cfg(not(windows))]
    {
        let shell_path = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        let mut command = Command::new(shell_path);
        command.args(["-lc", input]);
        command
    }
}

fn read_terminal_stream<R>(
    reader: R,
    stream: TerminalOutputStream,
    output: Arc<Mutex<VecDeque<TerminalOutputChunk>>>,
) where
    R: std::io::Read + Send + 'static,
{
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut buffer = Vec::new();

        loop {
            buffer.clear();

            match reader.read_until(b'\n', &mut buffer) {
                Ok(0) => break,
                Ok(_) => {
                    if buffer.len() > MAX_CHUNK_BYTES {
                        buffer.truncate(MAX_CHUNK_BYTES);
                        buffer.extend_from_slice(b"\n[output truncated]\n");
                    }

                    push_output(
                        &output,
                        stream.clone(),
                        String::from_utf8_lossy(&buffer).to_string(),
                    );
                }
                Err(error) => {
                    push_output(
                        &output,
                        TerminalOutputStream::System,
                        format!("Terminal stream ended: {}\n", error),
                    );
                    break;
                }
            }
        }
    });
}

fn push_output(
    output: &Arc<Mutex<VecDeque<TerminalOutputChunk>>>,
    stream: TerminalOutputStream,
    text: String,
) {
    let timestamp = now_millis();
    let chunk = TerminalOutputChunk {
        id: format!("terminal-output-{}-{}", timestamp, text.len()),
        stream,
        text,
        timestamp,
    };

    if let Ok(mut output) = output.lock() {
        output.push_back(chunk);

        while output.len() > MAX_BUFFERED_CHUNKS {
            output.pop_front();
        }
    }
}

fn drain_output(output: &Arc<Mutex<VecDeque<TerminalOutputChunk>>>) -> Vec<TerminalOutputChunk> {
    match output.lock() {
        Ok(mut output) => output.drain(..).collect(),
        Err(_) => Vec::new(),
    }
}

fn parse_change_directory(input: &str, working_directory: &Path) -> Option<PathBuf> {
    let trimmed = input.trim();
    let lower = trimmed.to_lowercase();
    let raw_path = if lower == "cd" || lower == "chdir" || lower == "set-location" {
        default_home_directory()?
    } else if lower.starts_with("cd ") {
        parse_cd_path(&trimmed[3..])?
    } else if lower.starts_with("chdir ") {
        parse_cd_path(&trimmed[6..])?
    } else if lower.starts_with("set-location ") {
        parse_cd_path(&trimmed[13..])?
    } else {
        return None;
    };

    Some(resolve_path_against(&raw_path, working_directory))
}

fn parse_cd_path(value: &str) -> Option<PathBuf> {
    let mut path = value.trim();

    if path.to_lowercase().starts_with("/d ") {
        path = path[3..].trim();
    }

    if path.starts_with("-path ") {
        path = path[6..].trim();
    }

    if path.is_empty() {
        return default_home_directory();
    }

    let unquoted = path.trim_matches('"').trim_matches('\'');

    if unquoted == "~" {
        return default_home_directory();
    }

    if let Some(rest) = unquoted
        .strip_prefix("~/")
        .or_else(|| unquoted.strip_prefix("~\\"))
    {
        return default_home_directory().map(|home| home.join(rest));
    }

    Some(PathBuf::from(unquoted))
}

fn resolve_path_against(path: &Path, working_directory: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        working_directory.join(path)
    }
}

fn resolve_working_directory(path: Option<String>) -> Result<PathBuf, String> {
    let candidate = path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(default_working_directory);

    let normalized = normalize_input_path(&candidate);

    if !normalized.exists() {
        return Err(format!(
            "Working directory does not exist: {}",
            path_to_string(&normalized)
        ));
    }

    if !normalized.is_dir() {
        return Err(format!(
            "Working directory is not a folder: {}",
            path_to_string(&normalized)
        ));
    }

    Ok(normalized)
}

fn default_working_directory() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    manifest_dir
        .parent()
        .map(Path::to_path_buf)
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn default_home_directory() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn normalize_input_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let path_string = path.to_string_lossy();

        if path_string.len() == 2 && path_string.ends_with(':') {
            return PathBuf::from(format!("{}\\", path_string));
        }
    }

    path.to_path_buf()
}

fn shell_label(shell: &TerminalShell) -> &'static str {
    match shell {
        TerminalShell::PowerShell => "PowerShell",
        TerminalShell::Cmd => "Command Prompt",
    }
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or_default()
}

fn path_to_string(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().to_string()
}
