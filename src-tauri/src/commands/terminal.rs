use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    io::Read,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const MAX_BUFFERED_CHUNKS: usize = 1_500;
const MAX_CHUNK_BYTES: usize = 64 * 1024;
const STREAM_READ_BYTES: usize = 8 * 1024;
const DEFAULT_RUN_TIMEOUT_MS: u64 = 45_000;
const MAX_RUN_TIMEOUT_MS: u64 = 180_000;
const MAX_RUN_OUTPUT_BYTES: usize = 16 * 1024 * 1024;

#[derive(Default)]
pub struct TerminalState {
    sessions: Mutex<HashMap<String, TerminalSession>>,
    next_id: AtomicU64,
}

struct TerminalSession {
    active_child: Option<Child>,
    active_command: Option<String>,
    exited: Option<i32>,
    last_command_completed: bool,
    last_command_exit_code: Option<i32>,
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
pub struct TerminalRunCommandRequest {
    pub command: String,
    pub shell: Option<TerminalShell>,
    pub timeout_ms: Option<u64>,
    pub working_directory: Option<String>,
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
    pub active_command: Option<String>,
    pub chunks: Vec<TerminalOutputChunk>,
    pub command_running: bool,
    pub exit_code: Option<i32>,
    pub last_command_completed: bool,
    pub last_command_exit_code: Option<i32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRunCommandResponse {
    pub duration_ms: u64,
    pub exit_code: Option<i32>,
    pub output_truncated: bool,
    pub shell: TerminalShell,
    pub stderr: String,
    pub stdout: String,
    pub timed_out: bool,
    pub working_directory: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub enum TerminalShell {
    #[serde(rename = "powershell")]
    PowerShell,
    #[serde(rename = "cmd")]
    Cmd,
    #[serde(rename = "bash")]
    Bash,
    #[serde(rename = "zsh")]
    Zsh,
    #[serde(rename = "sh")]
    Sh,
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
    let shell = normalize_terminal_shell(request.shell.unwrap_or_else(default_terminal_shell));
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
        last_command_completed: false,
        last_command_exit_code: None,
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

    session.last_command_completed = false;
    session.last_command_exit_code = None;

    push_output(
        &session.output,
        TerminalOutputStream::System,
        format!("Running command: {input}\n"),
    );

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
pub async fn terminal_run_command(
    request: TerminalRunCommandRequest,
) -> Result<TerminalRunCommandResponse, String> {
    tauri::async_runtime::spawn_blocking(move || run_command_blocking(request))
        .await
        .map_err(|error| {
            format!(
                "The terminal command worker stopped unexpectedly: {}",
                error
            )
        })?
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
        active_command: session.active_command.clone(),
        chunks: drain_output(&session.output),
        command_running: session.active_child.is_some(),
        exit_code: session.exited,
        last_command_completed: session.last_command_completed,
        last_command_exit_code: session.last_command_exit_code,
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

fn run_command_blocking(
    request: TerminalRunCommandRequest,
) -> Result<TerminalRunCommandResponse, String> {
    let shell = normalize_terminal_shell(request.shell.unwrap_or_else(default_terminal_shell));
    let working_directory = resolve_working_directory(request.working_directory)?;
    let input = request.command.trim();

    if input.is_empty() {
        return Err("Terminal command cannot be empty.".to_string());
    }

    let timeout_ms = request
        .timeout_ms
        .unwrap_or(DEFAULT_RUN_TIMEOUT_MS)
        .clamp(1_000, MAX_RUN_TIMEOUT_MS);
    let started_at = Instant::now();
    let mut command = create_shell_command(&shell, input);

    command
        .current_dir(&working_directory)
        .env("GILBERT_CODEX_TERMINAL", "1")
        .env("GILBERT_CODEX_AGENT_TOOL", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not run {} command: {}", shell_label(&shell), error))?;

    let stdout = Arc::new(Mutex::new(Vec::new()));
    let stderr = Arc::new(Mutex::new(Vec::new()));
    let output_limit_reached = Arc::new(AtomicBool::new(false));
    let mut readers = Vec::new();

    if let Some(child_stdout) = child.stdout.take() {
        readers.push(read_terminal_stream_to_buffer(
            child_stdout,
            Arc::clone(&stdout),
            Arc::clone(&output_limit_reached),
        ));
    }

    if let Some(child_stderr) = child.stderr.take() {
        readers.push(read_terminal_stream_to_buffer(
            child_stderr,
            Arc::clone(&stderr),
            Arc::clone(&output_limit_reached),
        ));
    }

    let (exit_code, timed_out) = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Could not inspect terminal command: {}", error))?
        {
            break (status.code(), false);
        }

        if output_limit_reached.load(Ordering::Relaxed) {
            let _ = child.kill();
            let status = child.wait().map_err(|error| {
                format!("Could not stop high-output terminal command: {}", error)
            })?;
            break (status.code(), false);
        }

        if started_at.elapsed() >= Duration::from_millis(timeout_ms) {
            let _ = child.kill();
            let status = child
                .wait()
                .map_err(|error| format!("Could not stop timed-out terminal command: {}", error))?;
            break (status.code(), true);
        }

        thread::sleep(Duration::from_millis(80));
    };

    for reader in readers {
        let _ = reader.join();
    }

    Ok(TerminalRunCommandResponse {
        duration_ms: started_at.elapsed().as_millis().min(u64::MAX as u128) as u64,
        exit_code,
        output_truncated: output_limit_reached.load(Ordering::Relaxed),
        shell,
        stderr: bytes_to_string(&stderr),
        stdout: bytes_to_string(&stdout),
        timed_out,
        working_directory: path_to_string(&working_directory),
    })
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
        session.last_command_completed = true;
        session.last_command_exit_code = status.code();
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
                let normalized_input = normalize_windows_powershell_command(input);
                command.creation_flags(CREATE_NO_WINDOW);
                command.args([
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    normalized_input.as_str(),
                ]);
                command
            }
            TerminalShell::Cmd => {
                let mut command = Command::new("cmd.exe");
                command.creation_flags(CREATE_NO_WINDOW);
                command.args(["/Q", "/C", input]);
                command
            }
            TerminalShell::Bash | TerminalShell::Zsh | TerminalShell::Sh => {
                let mut command = Command::new(unix_shell_program(shell));
                command.creation_flags(CREATE_NO_WINDOW);
                command.args(["-lc", input]);
                command
            }
        }
    }

    #[cfg(not(windows))]
    {
        match shell {
            TerminalShell::Bash | TerminalShell::Zsh | TerminalShell::Sh => {
                let mut command = Command::new(unix_shell_program(shell));
                command.args(["-lc", input]);
                command
            }
            TerminalShell::PowerShell | TerminalShell::Cmd => {
                let mut command = Command::new(default_unix_shell_path());
                command.args(["-lc", input]);
                command
            }
        }
    }
}

fn default_terminal_shell() -> TerminalShell {
    #[cfg(windows)]
    {
        TerminalShell::PowerShell
    }

    #[cfg(not(windows))]
    {
        default_unix_shell()
    }
}

fn normalize_terminal_shell(shell: TerminalShell) -> TerminalShell {
    #[cfg(windows)]
    {
        shell
    }

    #[cfg(not(windows))]
    {
        match shell {
            TerminalShell::PowerShell | TerminalShell::Cmd => default_unix_shell(),
            _ => shell,
        }
    }
}

#[cfg(not(windows))]
fn default_unix_shell() -> TerminalShell {
    let shell = default_unix_shell_path();
    let shell_name = Path::new(&shell)
        .file_name()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();

    match shell_name.as_str() {
        "zsh" => TerminalShell::Zsh,
        "bash" => TerminalShell::Bash,
        _ => TerminalShell::Sh,
    }
}

#[cfg(not(windows))]
fn default_unix_shell_path() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
}

fn unix_shell_program(shell: &TerminalShell) -> &'static str {
    match shell {
        TerminalShell::Bash => "bash",
        TerminalShell::Zsh => "zsh",
        TerminalShell::Sh => "sh",
        TerminalShell::PowerShell => "pwsh",
        TerminalShell::Cmd => "cmd",
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
        let mut reader = reader;
        let mut buffer = [0u8; STREAM_READ_BYTES];

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read_count) => {
                    push_output(
                        &output,
                        stream.clone(),
                        String::from_utf8_lossy(&buffer[..read_count.min(MAX_CHUNK_BYTES)])
                            .to_string(),
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

#[cfg(windows)]
fn normalize_windows_powershell_command(input: &str) -> String {
    let trimmed = input.trim_start();
    let leading_len = input.len().saturating_sub(trimmed.len());
    let leading = &input[..leading_len];
    let token_end = trimmed
        .char_indices()
        .find(|(_, character)| character.is_whitespace())
        .map(|(index, _)| index)
        .unwrap_or(trimmed.len());
    let token = &trimmed[..token_end];
    let rest = &trimmed[token_end..];
    let replacement = match token.to_ascii_lowercase().as_str() {
        "npm" => "npm.cmd",
        "npx" => "npx.cmd",
        "pnpm" => "pnpm.cmd",
        "yarn" => "yarn.cmd",
        _ => return input.to_string(),
    };

    format!("{leading}{replacement}{rest}")
}

fn read_terminal_stream_to_buffer<R>(
    mut reader: R,
    output: Arc<Mutex<Vec<u8>>>,
    output_limit_reached: Arc<AtomicBool>,
) -> thread::JoinHandle<()>
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut chunk = [0u8; 8 * 1024];

        loop {
            let read_count = match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(read_count) => read_count,
                Err(_) => break,
            };
            let mut should_stop = false;

            if let Ok(mut output) = output.lock() {
                let remaining = MAX_RUN_OUTPUT_BYTES.saturating_sub(output.len());

                if remaining == 0 {
                    mark_output_limit_reached(&mut output, &output_limit_reached);
                    should_stop = true;
                } else {
                    let write_count = remaining.min(read_count);
                    output.extend_from_slice(&chunk[..write_count]);

                    if write_count < read_count {
                        mark_output_limit_reached(&mut output, &output_limit_reached);
                        should_stop = true;
                    }
                }
            } else {
                should_stop = true;
            }

            if should_stop {
                break;
            }
        }
    })
}

fn mark_output_limit_reached(output: &mut Vec<u8>, output_limit_reached: &AtomicBool) {
    if !output_limit_reached.swap(true, Ordering::Relaxed) {
        output.extend_from_slice(b"\n[output limit reached; command stopped]\n");
    }
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
        TerminalShell::Bash => "Bash",
        TerminalShell::Zsh => "Zsh",
        TerminalShell::Sh => "sh",
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

fn bytes_to_string(output: &Arc<Mutex<Vec<u8>>>) -> String {
    output
        .lock()
        .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
        .unwrap_or_default()
}
