import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const wrapper = join(repoRoot, "scripts", "run-native-whisper-command.ps1");
const cargoArgs = ["check", "--manifest-path", "src-tauri/Cargo.toml", ...process.argv.slice(2)];

let command = "cargo";
let args = cargoArgs;

if (process.platform === "win32" && existsSync(wrapper)) {
  command = "powershell";
  args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", wrapper, "cargo", ...cargoArgs];
}

const child = spawn(command, args, {
  cwd: repoRoot,
  env: process.env,
  shell: false,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(`Could not start ${command}: ${error.message}`);
  process.exit(1);
});
