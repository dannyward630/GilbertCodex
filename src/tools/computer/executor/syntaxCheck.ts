import { getDefaultTerminalShell, getHostPlatform } from "../../../lib/terminalShells";
import { readComputerTextFile } from "../files";
import { joinLocalPath } from "./argHelpers";
import { quoteShellArg } from "./shell";

export async function inferSyntaxCheckCommand(root: string, paths: string[]) {
  const packageJson = await readPackageJson(root);

  if (packageJson?.scripts?.typecheck) {
    return packageManagerCommand("run typecheck");
  }

  if (packageJson?.scripts?.check) {
    return packageManagerCommand("run check");
  }

  if (packageJson?.scripts?.build) {
    return packageManagerCommand("run build");
  }

  if (packageJson?.scripts?.lint) {
    return packageManagerCommand("run lint");
  }

  if (await textFileExists(joinLocalPath(root, ["tsconfig.json"]))) {
    return packageBinCommand("tsc", "--noEmit");
  }

  const singleNodeCheckPath = paths.length === 1 && isNodeCheckableJavaScriptPath(paths[0]) ? paths[0] : "";

  if (singleNodeCheckPath) {
    return `${getHostPlatform() === "windows" ? "node.exe" : "node"} --check ${quoteShellArg(singleNodeCheckPath, getDefaultTerminalShell())}`;
  }

  if (await textFileExists(joinLocalPath(root, ["Cargo.toml"]))) {
    return "cargo check";
  }

  return "";
}

export function isSyntaxCheckCandidatePath(path: string) {
  return /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx|json|css|scss|sass|less|html|svelte|vue|rs|go|py|java|kt|swift)$/i.test(path);
}

function isNodeCheckableJavaScriptPath(path: string) {
  return /\.(?:cjs|js|mjs)$/i.test(path);
}

function packageManagerCommand(args: string) {
  return `${getHostPlatform() === "windows" ? "npm.cmd" : "npm"} ${args}`;
}

function packageBinCommand(binaryName: string, args: string) {
  const command = getHostPlatform() === "windows" ? `node_modules\\.bin\\${binaryName}.cmd` : `./node_modules/.bin/${binaryName}`;
  return `${command} ${args}`.trim();
}

async function readPackageJson(root: string) {
  const content = await readOptionalTextFile(joinLocalPath(root, ["package.json"]));

  if (!content) {
    return undefined;
  }

  try {
    return JSON.parse(content) as { scripts?: Record<string, string> };
  } catch {
    return undefined;
  }
}

async function readOptionalTextFile(path: string) {
  try {
    return (await readComputerTextFile(path, 192 * 1024)).content;
  } catch {
    return undefined;
  }
}

async function textFileExists(path: string) {
  try {
    await readComputerTextFile(path, 512);
    return true;
  } catch {
    return false;
  }
}
