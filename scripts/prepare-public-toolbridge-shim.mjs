import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const toolBridgeRoot = path.join(repoRoot, "src", "toolBridge");
const indexPath = path.join(toolBridgeRoot, "index.ts");
const powerShellSourcePath = path.join(scriptDir, "prepare-public-toolbridge-shim.ps1");
const force = process.argv.includes("--force");

if (!force && (await fileExists(indexPath))) {
  console.log("Existing local tool bridge found; public shim not needed.");
  process.exit(0);
}

const powerShellSource = await readFile(powerShellSourcePath, "utf8");
const shimFiles = parseShimFiles(powerShellSource);

if (shimFiles.length === 0) {
  throw new Error(`No shim files found in ${powerShellSourcePath}.`);
}

await mkdir(toolBridgeRoot, { recursive: true });

for (const shimFile of shimFiles) {
  const target = resolveShimPath(shimFile.relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, shimFile.content, "utf8");
}

console.log("Generated public-safe tool bridge shim for CI/release builds.");

async function fileExists(filePath) {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function parseShimFiles(source) {
  const files = [];
  const shimFilePattern = /Write-ShimFile\s+"([^"]+)"\s+@'\r?\n([\s\S]*?)\r?\n'@/g;

  for (const match of source.matchAll(shimFilePattern)) {
    files.push({
      relativePath: match[1],
      content: match[2],
    });
  }

  return files;
}

function resolveShimPath(relativePath) {
  const target = path.resolve(toolBridgeRoot, ...relativePath.split(/[\\/]+/));
  const rootWithSeparator = `${toolBridgeRoot}${path.sep}`;

  if (target !== toolBridgeRoot && !target.startsWith(rootWithSeparator)) {
    throw new Error(`Refusing to write shim file outside src/toolBridge: ${relativePath}`);
  }

  return target;
}
