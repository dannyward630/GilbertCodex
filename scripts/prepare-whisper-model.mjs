import { createHash } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import https from "node:https";

const DEFAULT_MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
const DEFAULT_EXPECTED_SHA1 = "137c40403d78fd54d454da0f9bd998f78703390c";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const modelUrl = process.env.GILBERT_WHISPER_MODEL_URL || DEFAULT_MODEL_URL;
const expectedSha1 = (process.env.GILBERT_WHISPER_MODEL_SHA1 || DEFAULT_EXPECTED_SHA1).toLowerCase();
const modelDir = join(repoRoot, "resources", "models", "whisper");
const modelPath = join(modelDir, "ggml-base.en.bin");
const tempPath = `${modelPath}.tmp`;

async function fileSha1(path) {
  const buffer = await fs.readFile(path);
  return createHash("sha1").update(buffer).digest("hex");
}

async function pathExists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

function requestModule(url) {
  return url.startsWith("https:") ? https : http;
}

async function downloadFile(url, destination, redirectCount = 0) {
  if (redirectCount > 5) {
    throw new Error("Too many redirects while downloading the Whisper model.");
  }

  await new Promise((resolve, reject) => {
    const request = requestModule(url).get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const nextUrl = new URL(response.headers.location, url).toString();
        downloadFile(nextUrl, destination, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${response.statusCode}.`));
        return;
      }

      const file = createWriteStream(destination);
      response.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    });

    request.on("error", reject);
  });
}

await fs.mkdir(modelDir, { recursive: true });

if (await pathExists(modelPath)) {
  const existingHash = await fileSha1(modelPath);
  if (existingHash === expectedSha1) {
    console.log("Whisper base.en model is already present and verified:");
    console.log(modelPath);
    process.exit(0);
  }

  console.log("Existing model hash did not match; replacing it.");
}

if (await pathExists(tempPath)) {
  await fs.rm(tempPath, { force: true });
}

console.log("Downloading Whisper base.en model...");
console.log(modelUrl);
await downloadFile(modelUrl, tempPath);

const downloadedHash = await fileSha1(tempPath);
if (downloadedHash !== expectedSha1) {
  await fs.rm(tempPath, { force: true });
  throw new Error(`Downloaded model SHA1 mismatch. Expected ${expectedSha1} but got ${downloadedHash}.`);
}

await fs.rename(tempPath, modelPath);
console.log("Whisper base.en model downloaded and verified:");
console.log(modelPath);
