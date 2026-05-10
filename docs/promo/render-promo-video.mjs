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
  await writeFile(videoPath, dataUrlToBuffer(video.dataUrl));

  const videoStats = await stat(videoPath);
  const posterStats = await stat(posterPath);

  console.log(`Rendered ${path.relative(process.cwd(), videoPath)} (${formatBytes(videoStats.size)}, ${video.mimeType})`);
  console.log(`Rendered ${path.relative(process.cwd(), posterPath)} (${formatBytes(posterStats.size)})`);
} finally {
  await browser.close();
}
