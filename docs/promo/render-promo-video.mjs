import { mkdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = __dirname;
const scenePath = path.join(__dirname, "promo.html");
const videoPath = path.join(outputDir, "gilbert-codex-promo.webm");
const posterPath = path.join(outputDir, "gilbert-codex-promo-poster.png");
const durationFallbackMs = 20_000;

function loadPlaywright() {
  try {
    return require("playwright");
  } catch (error) {
    console.error("Playwright is required to render the promo video.");
    console.error("Install it temporarily or run this from an environment that already provides Playwright.");
    console.error("Example: npm exec --package=playwright -- node docs/promo/render-promo-video.mjs");
    process.exitCode = 1;
    throw error;
  }
}

function dataUrlToBuffer(dataUrl) {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) {
    throw new Error("Unexpected data URL returned by the promo scene.");
  }

  return Buffer.from(dataUrl.slice(commaIndex + 1), "base64");
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function readElementId(buffer, offset) {
  const firstByte = buffer[offset];
  let length = 1;
  let marker = 0x80;

  while (length <= 4 && (firstByte & marker) === 0) {
    length += 1;
    marker >>= 1;
  }

  let value = 0;
  for (let index = 0; index < length; index += 1) {
    value = value * 256 + buffer[offset + index];
  }

  return { length, value };
}

function readVintSize(buffer, offset) {
  const firstByte = buffer[offset];
  let length = 1;
  let marker = 0x80;

  while (length <= 8 && (firstByte & marker) === 0) {
    length += 1;
    marker >>= 1;
  }

  let value = firstByte & (marker - 1);
  for (let index = 1; index < length; index += 1) {
    value = value * 256 + buffer[offset + index];
  }

  const unknown = value === 2 ** (7 * length) - 1;
  return { length, unknown, value };
}

function encodeVintSize(value, length) {
  if (value > 2 ** (7 * length) - 2) {
    throw new Error(`EBML size ${value} does not fit in ${length} byte(s).`);
  }

  const bytes = Buffer.alloc(length);
  let remaining = value;
  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  bytes[0] |= 1 << (8 - length);
  return bytes;
}

function createDurationElement(durationMs) {
  const payload = Buffer.alloc(8);
  payload.writeDoubleBE(durationMs, 0);
  return Buffer.concat([Buffer.from([0x44, 0x89, 0x88]), payload]);
}

function writeInfoSize(buffer, infoSizeOffset, infoSizeLength, nextInfoSize) {
  encodeVintSize(nextInfoSize, infoSizeLength).copy(buffer, infoSizeOffset);
}

function replaceInfoChild(buffer, info, childStart, childEnd, replacement) {
  const nextInfoSize = info.size.value + replacement.length - (childEnd - childStart);
  const nextBuffer = Buffer.concat([
    buffer.subarray(0, childStart),
    replacement,
    buffer.subarray(childEnd),
  ]);
  writeInfoSize(nextBuffer, info.sizeOffset, info.size.length, nextInfoSize);
  return nextBuffer;
}

function fixWebmDuration(buffer, durationMs) {
  const ebml = readElementId(buffer, 0);
  const ebmlSize = readVintSize(buffer, ebml.length);
  const segmentOffset = ebml.length + ebmlSize.length + ebmlSize.value;
  const segment = readElementId(buffer, segmentOffset);

  if (segment.value !== 0x18538067) {
    return buffer;
  }

  const segmentSize = readVintSize(buffer, segmentOffset + segment.length);
  let cursor = segmentOffset + segment.length + segmentSize.length;
  const durationElement = createDurationElement(durationMs);

  while (cursor < buffer.length) {
    const element = readElementId(buffer, cursor);
    const sizeOffset = cursor + element.length;
    const size = readVintSize(buffer, sizeOffset);
    const contentStart = sizeOffset + size.length;

    if (element.value === 0x1549a966) {
      const info = { size, sizeOffset };
      const infoEnd = contentStart + size.value;
      let childCursor = contentStart;

      while (childCursor < infoEnd) {
        const child = readElementId(buffer, childCursor);
        const childSize = readVintSize(buffer, childCursor + child.length);
        const childContentStart = childCursor + child.length + childSize.length;
        const childEnd = childContentStart + childSize.value;

        if (child.value === 0x4489) {
          return replaceInfoChild(buffer, info, childCursor, childEnd, durationElement);
        }

        childCursor = childEnd;
      }

      return replaceInfoChild(buffer, info, infoEnd, infoEnd, durationElement);
    }

    if (size.unknown) {
      break;
    }

    cursor = contentStart + size.value;
  }

  return buffer;
}

const { chromium } = loadPlaywright();

await mkdir(outputDir, { recursive: true });

const browserCandidates = [
  process.env.CHROMIUM_EXECUTABLE_PATH,
  chromium.executablePath(),
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

const launchOptions = {
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling"],
};

launchOptions.executablePath = browserCandidates.find((candidate) => existsSync(candidate));

if (!launchOptions.executablePath) {
  console.error("Could not find a Chromium-based browser executable.");
  console.error("Set CHROMIUM_EXECUTABLE_PATH or install Playwright browsers with: npx playwright install chromium");
  process.exit(1);
}

const browser = await chromium.launch(launchOptions);

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(scenePath).href);
  await page.waitForFunction(() => Boolean(window.renderGilbertPromoVideo));
  await page.evaluate(() => document.fonts?.ready);

  const posterDataUrl = await page.evaluate(() => window.renderGilbertPromoPoster(18_200));
  await writeFile(posterPath, dataUrlToBuffer(posterDataUrl));

  const video = await page.evaluate(() => window.renderGilbertPromoVideo({ fps: 30 }));
  const videoBuffer = fixWebmDuration(dataUrlToBuffer(video.dataUrl), video.durationMs ?? durationFallbackMs);
  await writeFile(videoPath, videoBuffer);

  const videoStats = await stat(videoPath);
  const posterStats = await stat(posterPath);

  console.log(`Rendered ${path.relative(process.cwd(), videoPath)} (${formatBytes(videoStats.size)}, ${video.mimeType})`);
  console.log(`Rendered ${path.relative(process.cwd(), posterPath)} (${formatBytes(posterStats.size)})`);
} finally {
  await browser.close();
}
