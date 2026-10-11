import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.OSD_BASE_URL || "http://127.0.0.1:4173/web/index.html";
const browser = await chromium.launch({ headless: true });
const errors = [];
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));

function makePcmWav({ seconds = 0.5, sampleRate = 44100, frequency = 440, amplitude = 0.12 } = {}) {
  const frames = Math.floor(seconds * sampleRate);
  const dataBytes = frames * 2;
  const out = Buffer.alloc(44 + dataBytes);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + dataBytes, 4);
  out.write("WAVE", 8);
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write("data", 36);
  out.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < frames; i++) {
    const sample = Math.round(Math.sin(2 * Math.PI * frequency * i / sampleRate) * amplitude * 32767);
    out.writeInt16LE(sample, 44 + i * 2);
  }
  return out;
}

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  assert.match(await page.title(), /Origin Sound Department|OSD/i);
  assert.equal(await page.locator("#render").isDisabled(), true, "render must remain disabled before a source is loaded");

  await page.locator("#file-dialogue").setInputFiles({
    name: "osd-smoke-dialogue.wav",
    mimeType: "audio/wav",
    buffer: makePcmWav()
  });

  await page.waitForFunction(() => {
    const state = document.querySelector("#state-dialogue")?.textContent || "";
    return state.startsWith("Ready") || state.startsWith("Source rejected");
  }, null, { timeout: 20000 });

  const sourceState = await page.locator("#state-dialogue").innerText();
  assert.match(sourceState, /^Ready\b/, "source import did not succeed: " + sourceState);
  await page.waitForFunction(() => !document.querySelector("#render")?.disabled, null, { timeout: 5000 });
  assert.match(await page.locator("#log").innerText(), /SOURCE_MEMORY_PREFLIGHT/);
  assert.match(await page.locator("#log").innerText(), /SOURCE_MEMORY_POST_DECODE_CHECK.*passed=true/);

  await page.locator("#render").click();
  await page.waitForFunction(() => {
    const message = document.querySelector("#message")?.textContent || "";
    return message.startsWith("Stereo WAV created") || message.startsWith("Render stopped") || message.startsWith("Mix did not complete");
  }, null, { timeout: 20000 });

  const renderMessage = await page.locator("#message").innerText();
  assert.match(renderMessage, /^Stereo WAV created\b/, "render did not succeed: " + renderMessage);
  assert.equal(await page.locator("#mixPreview").isVisible(), true);
  assert.match(await page.locator("#log").innerText(), /header_check=PASS pcm_scan=PASS frame_count_check=PASS blob_size_check=PASS/);

  const audioSrc = await page.locator("#mixPlayer").getAttribute("src");
  assert.ok(audioSrc?.startsWith("blob:"), "rendered preview must reference a local Blob URL");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#saveProject").click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /\.json$/i);
  const projectPath = await download.path();
  const project = JSON.parse(await readFile(projectPath, "utf8"));
  assert.equal(project.format, "OSD-WEB-PROJECT");
  assert.ok(project.sources?.dialogue?.sha256, "project should record the source fingerprint");
  assert.equal(project.sources?.dialogue?.decoded, true);
  assert.ok(!Object.hasOwn(project, "audioData"), "project must not silently embed source audio");

  assert.deepEqual(errors, [], "uncaught page errors: " + errors.join("; "));
  console.log(JSON.stringify({
    status: "PASS",
    sourceImport: "PASS",
    preflightAndPostDecodeMemoryChecks: "PASS",
    stereoWavRenderAndSerializedPcmQc: "PASS",
    localPreview: "PASS",
    projectJsonDownloadAndFingerprint: "PASS",
    uncaughtPageErrors: errors.length
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
