import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");

const targetScript =
  process.platform === "win32"
    ? "app:build:windows"
    : process.platform === "darwin"
      ? "app:build:macos"
      : process.platform === "linux"
        ? "app:build:linux"
        : null;

if (!targetScript) {
  console.error(`Gilbert Codex does not have a desktop build script for ${process.platform}.`);
  process.exit(1);
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(npmCommand, ["run", targetScript], {
  cwd: repoRoot,
  env: process.env,
  shell: process.platform === "win32",
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
  console.error(`Could not start ${npmCommand}: ${error.message}`);
  process.exit(1);
});
