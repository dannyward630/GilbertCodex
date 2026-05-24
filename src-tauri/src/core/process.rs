use std::{
    io,
    process::{Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const PROBE_KILL_REAP_WAIT_MS: u64 = 250;

pub fn hide_command_window(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    command
}

pub fn spawn_detached_command(command: &mut Command, failure_message: &str) -> Result<(), String> {
    hide_command_window(command)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("{failure_message}: {error}"))
}

pub fn open_external_target(target: &str, failure_message: &str) -> Result<(), String> {
    let mut command = if cfg!(windows) {
        let mut command = Command::new("rundll32.exe");
        command.args(["url.dll,FileProtocolHandler", target]);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(target);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(target);
        command
    };

    spawn_detached_command(&mut command, failure_message)
}

pub fn run_probe_command(mut command: Command, timeout: Duration) -> io::Result<Option<Output>> {
    hide_command_window(&mut command)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn()?;
    let started_at = Instant::now();

    loop {
        if child.try_wait()?.is_some() {
            return child.wait_with_output().map(Some);
        }

        if started_at.elapsed() >= timeout {
            let _ = child.kill();
            wait_for_child_exit(&mut child, Duration::from_millis(PROBE_KILL_REAP_WAIT_MS));
            return Ok(None);
        }

        thread::sleep(Duration::from_millis(25));
    }
}

fn wait_for_child_exit(child: &mut std::process::Child, timeout: Duration) {
    let started_at = Instant::now();

    while started_at.elapsed() < timeout {
        match child.try_wait() {
            Ok(Some(_)) | Err(_) => return,
            Ok(None) => thread::sleep(Duration::from_millis(25)),
        }
    }
}
