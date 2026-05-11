use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(windows)]
const WINDOWS_POWERSHELL_COMPAT_PRELUDE: &str = r#"
Remove-Item Alias:curl -ErrorAction SilentlyContinue
Remove-Item Alias:wget -ErrorAction SilentlyContinue
function global:__gilbert_count_or_default {
    param([object]$Value, [int]$Default)
    $raw = [string]$Value
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return $Default
    }
    if ($raw.StartsWith('-')) {
        $raw = $raw.Substring(1)
    }
    $parsed = 0
    if ([int]::TryParse($raw, [ref]$parsed)) {
        return [Math]::Max(0, [Math]::Abs($parsed))
    }
    return $Default
}
function global:head {
    [CmdletBinding()]
    param(
        [Parameter(Position=0)]
        [Alias('n')]
        [object]$Count = 10,
        [Parameter(Position=1, ValueFromRemainingArguments=$true)]
        [string[]]$Path,
        [Parameter(ValueFromPipeline=$true)]
        $InputObject
    )
    begin { $items = New-Object System.Collections.Generic.List[object] }
    process { [void]$items.Add($InputObject) }
    end {
        $take = __gilbert_count_or_default $Count 10
        if ($items.Count -gt 0) {
            $items | Select-Object -First $take
            return
        }
        if (($Path -eq $null -or $Path.Count -eq 0) -and $Count -is [string] -and (Test-Path -LiteralPath $Count)) {
            Get-Content -LiteralPath $Count -TotalCount $take
            return
        }
        if ($Path -ne $null -and $Path.Count -gt 0) {
            Get-Content -LiteralPath $Path -TotalCount $take
        }
    }
}
function global:tail {
    [CmdletBinding()]
    param(
        [Parameter(Position=0)]
        [Alias('n')]
        [object]$Count = 10,
        [Parameter(Position=1, ValueFromRemainingArguments=$true)]
        [string[]]$Path,
        [Parameter(ValueFromPipeline=$true)]
        $InputObject
    )
    begin { $items = New-Object System.Collections.Generic.List[object] }
    process { [void]$items.Add($InputObject) }
    end {
        $take = __gilbert_count_or_default $Count 10
        if ($items.Count -gt 0) {
            $items | Select-Object -Last $take
            return
        }
        if (($Path -eq $null -or $Path.Count -eq 0) -and $Count -is [string] -and (Test-Path -LiteralPath $Count)) {
            Get-Content -LiteralPath $Count -Tail $take
            return
        }
        if ($Path -ne $null -and $Path.Count -gt 0) {
            Get-Content -LiteralPath $Path -Tail $take
        }
    }
}
function global:grep {
    [CmdletBinding()]
    param(
        [Alias('i')]
        [switch]$IgnoreCase,
        [Alias('n')]
        [switch]$LineNumber,
        [Alias('v')]
        [switch]$InvertMatch,
        [Parameter(Position=0)]
        [string]$Pattern,
        [Parameter(Position=1, ValueFromRemainingArguments=$true)]
        [string[]]$Path,
        [Parameter(ValueFromPipeline=$true)]
        $InputObject
    )
    begin { $items = New-Object System.Collections.Generic.List[object] }
    process { [void]$items.Add($InputObject) }
    end {
        if ([string]::IsNullOrWhiteSpace($Pattern)) {
            return
        }
        $selectParams = @{ Pattern = $Pattern }
        if (-not $IgnoreCase) {
            $selectParams['CaseSensitive'] = $true
        }
        if ($InvertMatch) {
            $selectParams['NotMatch'] = $true
        }
        if ($items.Count -gt 0) {
            $items | Select-String @selectParams
            return
        }
        if ($Path -ne $null -and $Path.Count -gt 0) {
            Select-String @selectParams -Path $Path
        }
    }
}
function global:which {
    [CmdletBinding()]
    param([Parameter(Position=0)][string]$Name)
    if ([string]::IsNullOrWhiteSpace($Name)) {
        return
    }
    Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
}
"#;

const MAX_BUFFERED_CHUNKS: usize = 1_500;
const MAX_CHUNK_BYTES: usize = 64 * 1024;
const STREAM_READ_BYTES: usize = 8 * 1024;
const DEFAULT_RUN_TIMEOUT_MS: u64 = 45_000;
const MAX_RUN_TIMEOUT_MS: u64 = 600_000;
const MAX_RUN_OUTPUT_BYTES: usize = 16 * 1024 * 1024;

#[derive(Default)]
pub struct TerminalState {
    sessions: Mutex<HashMap<String, TerminalSession>>,
    next_id: AtomicU64,
}

struct TerminalSession {
    active_child: Option<Box<dyn PtyChild + Send + Sync>>,
    active_command: Option<String>,
    active_pty: Option<Box<dyn MasterPty + Send>>,
    active_stdin: Option<Box<dyn Write + Send>>,
    exited: Option<i32>,
    last_command_completed: bool,
    last_command_exit_code: Option<i32>,
    output: Arc<Mutex<VecDeque<TerminalOutputChunk>>>,
    shell: TerminalShell,
    mode: TerminalSessionMode,
    working_directory: PathBuf,
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        if let Some(child) = self.active_child.as_mut() {
            let _ = child.kill();
        }
        self.active_stdin.take();
        self.active_pty.take();
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCreateSessionRequest {
    pub mode: Option<TerminalSessionMode>,
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeSessionRequest {
    pub cols: u16,
    pub rows: u16,
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
    pub working_directory: String,
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

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub enum TerminalSessionMode {
    #[serde(rename = "command")]
    Command,
    #[serde(rename = "interactive")]
    Interactive,
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
pub fn terminal_get_default_working_directory() -> String {
    path_to_string(default_working_directory())
}

#[tauri::command]
pub fn terminal_create_session(
    state: tauri::State<'_, TerminalState>,
    request: TerminalCreateSessionRequest,
) -> Result<TerminalCreateSessionResponse, String> {
    let shell = normalize_terminal_shell(request.shell.unwrap_or_else(default_terminal_shell));
    let mode = request.mode.unwrap_or(TerminalSessionMode::Command);
    let working_directory = resolve_working_directory(request.working_directory)?;
    let output = Arc::new(Mutex::new(VecDeque::new()));

    push_output(
        &output,
        TerminalOutputStream::System,
        format!(
            "Started {} {} in {}\n",
            shell_label(&shell),
            if mode == TerminalSessionMode::Interactive {
                "terminal"
            } else {
                "command runner"
            },
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
    let mut active_child = None;
    let mut active_pty = None;
    let mut active_stdin = None;

    if mode == TerminalSessionMode::Interactive {
        let (child, pty, stdin) =
            spawn_interactive_terminal(&shell, &working_directory, Arc::clone(&output))?;
        active_child = Some(child);
        active_pty = Some(pty);
        active_stdin = Some(stdin);
    }

    let session = TerminalSession {
        active_child,
        active_command: None,
        active_pty,
        active_stdin,
        exited: None,
        last_command_completed: false,
        last_command_exit_code: None,
        output: Arc::clone(&output),
        shell,
        mode,
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

    if session.mode == TerminalSessionMode::Interactive {
        let stdin = session
            .active_stdin
            .as_mut()
            .ok_or_else(|| "The terminal shell is not accepting input.".to_string())?;

        stdin
            .write_all(request.input.as_bytes())
            .and_then(|_| stdin.flush())
            .map_err(|error| format!("Could not write to the terminal: {error}"))?;
        return Ok(());
    }

    if session.active_child.is_some() {
        let process_input = request.input.trim_end_matches(['\r', '\n']);
        let stdin = session
            .active_stdin
            .as_mut()
            .ok_or_else(|| "The running command is not accepting terminal input.".to_string())?;

        stdin
            .write_all(format!("{process_input}\r\n").as_bytes())
            .and_then(|_| stdin.flush())
            .map_err(|error| format!("Could not write to the running command: {error}"))?;
        return Ok(());
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

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Could not open terminal: {error}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Could not read from terminal: {error}"))?;
    let child_stdin = pair
        .master
        .take_writer()
        .map_err(|error| format!("Could not write to terminal: {error}"))?;
    let command = create_pty_shell_command(&session.shell, input, &session.working_directory);
    let child = pair.slave.spawn_command(command).map_err(|error| {
        format!(
            "Could not run {} command: {}",
            shell_label(&session.shell),
            error
        )
    })?;

    read_terminal_stream(
        reader,
        TerminalOutputStream::Stdout,
        Arc::clone(&session.output),
        true,
    );

    session.active_child = Some(child);
    session.active_command = Some(input.to_string());
    session.active_pty = Some(pair.master);
    session.active_stdin = Some(child_stdin);

    Ok(())
}

#[tauri::command]
pub fn terminal_resize_session(
    state: tauri::State<'_, TerminalState>,
    request: TerminalResizeSessionRequest,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "The terminal session registry is busy. Try again in a moment.".to_string())?;
    let session = sessions
        .get_mut(&request.session_id)
        .ok_or_else(|| "That terminal session is no longer available.".to_string())?;

    let Some(pty) = session.active_pty.as_mut() else {
        return Ok(());
    };
    let rows = request.rows.clamp(4, 200);
    let cols = request.cols.clamp(20, 500);

    pty.resize(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    })
    .map_err(|error| format!("Could not resize terminal: {error}"))
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
        command_running: session.mode == TerminalSessionMode::Command
            && session.active_child.is_some(),
        exit_code: session.exited,
        last_command_completed: session.last_command_completed,
        last_command_exit_code: session.last_command_exit_code,
        working_directory: path_to_string(&session.working_directory),
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
            session.active_stdin.take();
            session.active_pty.take();
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
        session.active_stdin.take();
        session.active_pty.take();
        let exit_code = status.exit_code() as i32;
        if session.mode == TerminalSessionMode::Interactive {
            session.exited = Some(exit_code);
        } else {
            session.last_command_completed = true;
            session.last_command_exit_code = Some(exit_code);
        }
        let command = session
            .active_command
            .take()
            .unwrap_or_else(|| "terminal".to_string());

        if session.mode == TerminalSessionMode::Interactive {
            let message = if status.success() {
                "Terminal exited.\n".to_string()
            } else if let Some(signal) = status.signal() {
                format!("Terminal stopped by {signal}.\n")
            } else {
                format!("Terminal exited with code {exit_code}.\n")
            };
            push_output(&session.output, TerminalOutputStream::System, message);
        } else {
            if status.success() {
                push_output(
                    &session.output,
                    TerminalOutputStream::System,
                    format!("Command finished: {command}\n"),
                );
            } else if let Some(signal) = status.signal() {
                push_output(
                    &session.output,
                    TerminalOutputStream::System,
                    format!("Command stopped by {signal}: {command}\n"),
                );
            } else {
                push_output(
                    &session.output,
                    TerminalOutputStream::System,
                    format!("Command exited with code {exit_code}: {command}\n"),
                );
            }
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
                let normalized_input = create_windows_powershell_command(input);
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

fn spawn_interactive_terminal(
    shell: &TerminalShell,
    working_directory: &Path,
    output: Arc<Mutex<VecDeque<TerminalOutputChunk>>>,
) -> Result<
    (
        Box<dyn PtyChild + Send + Sync>,
        Box<dyn MasterPty + Send>,
        Box<dyn Write + Send>,
    ),
    String,
> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Could not open terminal: {error}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Could not read from terminal: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("Could not write to terminal: {error}"))?;
    let command = create_interactive_shell_command(shell, working_directory);
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Could not start {} terminal: {}", shell_label(shell), error))?;

    read_terminal_stream(reader, TerminalOutputStream::Stdout, output, false);

    Ok((child, pair.master, writer))
}

fn create_interactive_shell_command(
    shell: &TerminalShell,
    working_directory: &Path,
) -> CommandBuilder {
    #[cfg(windows)]
    {
        let mut command = match shell {
            TerminalShell::PowerShell => {
                let mut command = CommandBuilder::new("powershell.exe");
                command.args([
                    "-NoLogo",
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-NoExit",
                    "-Command",
                    WINDOWS_POWERSHELL_COMPAT_PRELUDE,
                ]);
                command
            }
            TerminalShell::Cmd => {
                let mut command = CommandBuilder::new("cmd.exe");
                command.args(["/Q"]);
                command
            }
            TerminalShell::Bash | TerminalShell::Zsh | TerminalShell::Sh => {
                let mut command = CommandBuilder::new(unix_shell_program(shell));
                command.arg("-i");
                command
            }
        };

        configure_pty_command(&mut command, working_directory);
        command
    }

    #[cfg(not(windows))]
    {
        let mut command = match shell {
            TerminalShell::Bash | TerminalShell::Zsh | TerminalShell::Sh => {
                let mut command = CommandBuilder::new(unix_shell_program(shell));
                command.arg("-i");
                command
            }
            TerminalShell::PowerShell | TerminalShell::Cmd => {
                let mut command = CommandBuilder::new(default_unix_shell_path());
                command.arg("-i");
                command
            }
        };

        configure_pty_command(&mut command, working_directory);
        command
    }
}

fn create_pty_shell_command(
    shell: &TerminalShell,
    input: &str,
    working_directory: &Path,
) -> CommandBuilder {
    #[cfg(windows)]
    {
        let mut command = match shell {
            TerminalShell::PowerShell => {
                let mut command = CommandBuilder::new("powershell.exe");
                let normalized_input = create_windows_powershell_command(input);
                command.args([
                    "-NoLogo",
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    normalized_input.as_str(),
                ]);
                command
            }
            TerminalShell::Cmd => {
                let mut command = CommandBuilder::new("cmd.exe");
                command.args(["/Q", "/C", input]);
                command
            }
            TerminalShell::Bash | TerminalShell::Zsh | TerminalShell::Sh => {
                let mut command = CommandBuilder::new(unix_shell_program(shell));
                command.args(["-lc", input]);
                command
            }
        };

        configure_pty_command(&mut command, working_directory);
        command
    }

    #[cfg(not(windows))]
    {
        let mut command = match shell {
            TerminalShell::Bash | TerminalShell::Zsh | TerminalShell::Sh => {
                let mut command = CommandBuilder::new(unix_shell_program(shell));
                command.args(["-lc", input]);
                command
            }
            TerminalShell::PowerShell | TerminalShell::Cmd => {
                let mut command = CommandBuilder::new(default_unix_shell_path());
                command.args(["-lc", input]);
                command
            }
        };

        configure_pty_command(&mut command, working_directory);
        command
    }
}

fn configure_pty_command(command: &mut CommandBuilder, working_directory: &Path) {
    command.cwd(working_directory);
    command.env("GILBERT_CODEX_TERMINAL", "1");
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
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
    clean_control_sequences: bool,
) where
    R: std::io::Read + Send + 'static,
{
    thread::spawn(move || {
        let mut reader = reader;
        let mut buffer = [0u8; STREAM_READ_BYTES];
        let mut cleaner = TerminalOutputCleaner::default();

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read_count) => {
                    let raw_text =
                        String::from_utf8_lossy(&buffer[..read_count.min(MAX_CHUNK_BYTES)]);
                    let text = if clean_control_sequences {
                        cleaner.clean(&raw_text)
                    } else {
                        raw_text.to_string()
                    };

                    if !text.is_empty() {
                        push_output(&output, stream.clone(), text);
                    }
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

#[cfg(windows)]
fn create_windows_powershell_command(input: &str) -> String {
    let normalized_input = normalize_windows_powershell_command(input);
    format!("{WINDOWS_POWERSHELL_COMPAT_PRELUDE}\n{normalized_input}")
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
    default_user_terminal_directory()
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn default_home_directory() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn default_user_terminal_directory() -> Option<PathBuf> {
    let home = default_home_directory()?;

    if home.is_dir() {
        return Some(home);
    }

    None
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
        .map(|bytes| clean_terminal_output_text(&String::from_utf8_lossy(&bytes)))
        .unwrap_or_default()
}

fn clean_terminal_output_text(value: &str) -> String {
    TerminalOutputCleaner::default().clean(value)
}

#[derive(Clone, Copy, Default)]
enum TerminalOutputCleanerState {
    #[default]
    Ground,
    Escape,
    ControlSequence,
    OperatingSystemCommand,
    OperatingSystemCommandEscape,
    StringCommand,
    StringCommandEscape,
}

#[derive(Default)]
struct TerminalOutputCleaner {
    state: TerminalOutputCleanerState,
}

impl TerminalOutputCleaner {
    fn clean(&mut self, value: &str) -> String {
        let mut cleaned = String::with_capacity(value.len());

        for character in value.chars() {
            self.consume(character, &mut cleaned);
        }

        cleaned
    }

    fn consume(&mut self, character: char, cleaned: &mut String) {
        match self.state {
            TerminalOutputCleanerState::Ground => self.consume_ground(character, cleaned),
            TerminalOutputCleanerState::Escape => self.consume_escape(character),
            TerminalOutputCleanerState::ControlSequence => {
                if ('@'..='~').contains(&character) {
                    self.state = TerminalOutputCleanerState::Ground;
                }
            }
            TerminalOutputCleanerState::OperatingSystemCommand => {
                if character == '\u{7}' {
                    self.state = TerminalOutputCleanerState::Ground;
                } else if character == '\u{1b}' {
                    self.state = TerminalOutputCleanerState::OperatingSystemCommandEscape;
                }
            }
            TerminalOutputCleanerState::OperatingSystemCommandEscape => {
                self.state = if character == '\\' {
                    TerminalOutputCleanerState::Ground
                } else {
                    TerminalOutputCleanerState::OperatingSystemCommand
                };
            }
            TerminalOutputCleanerState::StringCommand => {
                if character == '\u{1b}' {
                    self.state = TerminalOutputCleanerState::StringCommandEscape;
                }
            }
            TerminalOutputCleanerState::StringCommandEscape => {
                self.state = if character == '\\' {
                    TerminalOutputCleanerState::Ground
                } else {
                    TerminalOutputCleanerState::StringCommand
                };
            }
        }
    }

    fn consume_ground(&mut self, character: char, cleaned: &mut String) {
        match character {
            '\u{1b}' => self.state = TerminalOutputCleanerState::Escape,
            '\u{90}' | '\u{98}' | '\u{9e}' | '\u{9f}' => {
                self.state = TerminalOutputCleanerState::StringCommand
            }
            '\u{9b}' => self.state = TerminalOutputCleanerState::ControlSequence,
            '\u{9d}' => self.state = TerminalOutputCleanerState::OperatingSystemCommand,
            '\u{7}' => {}
            '\n' | '\r' | '\t' => cleaned.push(character),
            value if value.is_control() => {}
            value => cleaned.push(value),
        }
    }

    fn consume_escape(&mut self, character: char) {
        self.state = match character {
            '[' => TerminalOutputCleanerState::ControlSequence,
            ']' => TerminalOutputCleanerState::OperatingSystemCommand,
            'P' | 'X' | '^' | '_' => TerminalOutputCleanerState::StringCommand,
            _ => TerminalOutputCleanerState::Ground,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_working_directory() -> String {
        env!("CARGO_MANIFEST_DIR").to_string()
    }

    fn run_test_command(command: &str, shell: TerminalShell) -> TerminalRunCommandResponse {
        run_command_blocking(TerminalRunCommandRequest {
            command: command.to_string(),
            shell: Some(shell),
            timeout_ms: Some(10_000),
            working_directory: Some(test_working_directory()),
        })
        .expect("terminal command should run")
    }

    #[test]
    fn command_runner_captures_stdout() {
        #[cfg(windows)]
        let response = run_test_command("Write-Output terminal-ok", TerminalShell::PowerShell);
        #[cfg(not(windows))]
        let response = run_test_command("printf terminal-ok", TerminalShell::Sh);

        assert_eq!(response.exit_code, Some(0));
        assert!(!response.timed_out);
        assert!(
            response.stdout.contains("terminal-ok"),
            "stdout was {:?}",
            response.stdout
        );
    }

    #[test]
    fn command_runner_captures_stderr_and_exit_code() {
        #[cfg(windows)]
        let response = run_test_command(
            "[Console]::Error.WriteLine('terminal-error'); exit 7",
            TerminalShell::PowerShell,
        );
        #[cfg(not(windows))]
        let response = run_test_command("printf terminal-error >&2; exit 7", TerminalShell::Sh);

        assert_eq!(response.exit_code, Some(7));
        assert!(!response.timed_out);
        assert!(
            response.stderr.contains("terminal-error"),
            "stderr was {:?}",
            response.stderr
        );
    }

    #[cfg(windows)]
    #[test]
    fn command_runner_executes_cmd_wrapper_from_powershell_shell() {
        let response =
            run_test_command("cmd /c \"echo terminal-cmd-ok\"", TerminalShell::PowerShell);

        assert_eq!(response.exit_code, Some(0));
        assert!(!response.timed_out);
        assert!(
            response.stdout.contains("terminal-cmd-ok"),
            "stdout was {:?}",
            response.stdout
        );
    }

    #[cfg(windows)]
    #[test]
    fn powershell_command_normalizes_node_package_shims() {
        assert_eq!(
            normalize_windows_powershell_command("npm install"),
            "npm.cmd install"
        );
        assert_eq!(
            normalize_windows_powershell_command("npx vite --version"),
            "npx.cmd vite --version"
        );
        assert_eq!(
            normalize_windows_powershell_command("pnpm test"),
            "pnpm.cmd test"
        );
        assert_eq!(
            normalize_windows_powershell_command("yarn build"),
            "yarn.cmd build"
        );
    }

    #[cfg(windows)]
    #[test]
    fn command_runner_executes_npm_shim_when_available() {
        let npm_available = Command::new("cmd.exe")
            .args(["/Q", "/C", "where npm.cmd"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false);

        if !npm_available {
            return;
        }

        let response = run_test_command("npm --version", TerminalShell::PowerShell);

        assert_eq!(response.exit_code, Some(0));
        assert!(!response.timed_out);
        assert!(
            !response.stdout.trim().is_empty(),
            "stdout was {:?}",
            response.stdout
        );
    }

    #[cfg(windows)]
    #[test]
    fn powershell_command_supports_common_inspection_helpers() {
        let head_response = run_test_command(
            "'alpha','beta','gamma' | head -2",
            TerminalShell::PowerShell,
        );
        assert_eq!(head_response.exit_code, Some(0));
        assert!(head_response.stdout.contains("alpha"));
        assert!(head_response.stdout.contains("beta"));
        assert!(!head_response.stdout.contains("gamma"));

        let tail_response = run_test_command(
            "'alpha','beta','gamma' | tail -2",
            TerminalShell::PowerShell,
        );
        assert_eq!(tail_response.exit_code, Some(0));
        assert!(!tail_response.stdout.contains("alpha"));
        assert!(tail_response.stdout.contains("beta"));
        assert!(tail_response.stdout.contains("gamma"));

        let grep_response = run_test_command(
            "'alpha','beta','gamma' | grep beta",
            TerminalShell::PowerShell,
        );
        assert_eq!(grep_response.exit_code, Some(0));
        assert!(!grep_response.stdout.contains("alpha"));
        assert!(grep_response.stdout.contains("beta"));
        assert!(!grep_response.stdout.contains("gamma"));
    }

    #[cfg(windows)]
    #[test]
    fn powershell_command_prefers_curl_exe_alias() {
        let curl_available = Command::new("cmd.exe")
            .args(["/Q", "/C", "where curl.exe"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false);

        if !curl_available {
            return;
        }

        let response = run_test_command("curl --version | head -1", TerminalShell::PowerShell);

        assert_eq!(response.exit_code, Some(0));
        assert!(!response.timed_out);
        assert!(
            response.stdout.to_ascii_lowercase().contains("curl"),
            "stdout was {:?}",
            response.stdout
        );
    }

    #[test]
    fn terminal_output_cleaner_strips_split_ansi_sequences() {
        let mut cleaner = TerminalOutputCleaner::default();

        assert_eq!(cleaner.clean("\u{1b}"), "");
        assert_eq!(cleaner.clean("[36mhttp://localhost:"), "http://localhost:");
        assert_eq!(cleaner.clean("\u{1b}[1m5174\u{1b}[22m/\u{1b}[39m"), "5174/");
    }

    #[test]
    fn terminal_output_cleaner_strips_split_title_sequences() {
        let mut cleaner = TerminalOutputCleaner::default();

        assert_eq!(cleaner.clean("\u{1b}]0;dev server"), "");
        assert_eq!(cleaner.clean("\u{7}ready\n"), "ready\n");
    }
}
