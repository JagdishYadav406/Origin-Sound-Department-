import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.OSD_BASE_URL || "http://127.0.0.1:4173/web/index.html";
const browser = await chromium.launch({ headless: true });
const errors = [];
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));

function makePcmWav({ seconds = 0.5, sampleRate = 44100, frequency = 120, amplitude = 0.12 } = {}) {
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
  const flatEqPcm = await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.querySelector("#mixPlayer").src)).arrayBuffer()).slice(44)));

  assert.equal(await page.locator("#mute-dialogue").count(), 1, "dialogue mute control should exist");
  assert.equal(await page.locator("#solo-dialogue").count(), 1, "dialogue solo control should exist");
  await page.locator("#file-music").setInputFiles({
    name: "osd-smoke-music.wav",
    mimeType: "audio/wav",
    buffer: makePcmWav({ frequency: 440, amplitude: 0.06 })
  });
  await page.waitForFunction(() => (document.querySelector("#state-music")?.textContent || "").startsWith("Ready") || (document.querySelector("#state-music")?.textContent || "").startsWith("Source rejected"), null, { timeout: 20000 });
  assert.match(await page.locator("#state-music").innerText(), /^Ready\b/, "music source import failed");
  await page.locator("#solo-dialogue").click();
  await page.locator("#render").click();
  await page.waitForFunction(() => (document.querySelector("#message")?.textContent || "").startsWith("Stereo WAV created") || (document.querySelector("#message")?.textContent || "").startsWith("Mix did not complete"), null, { timeout: 20000 });
  assert.match(await page.locator("#message").innerText(), /^Stereo WAV created\b/, "solo render should complete");
  const soloPcm = await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.querySelector("#mixPlayer").src)).arrayBuffer()).slice(44)));
  assert.deepEqual(soloPcm, flatEqPcm, "soloing dialogue should exclude the simultaneously loaded music track");
  await page.locator("#solo-dialogue").click();
  await page.locator("#mute-music").click();
  await page.locator("#render").click();
  await page.waitForFunction(() => (document.querySelector("#message")?.textContent || "").startsWith("Stereo WAV created") || (document.querySelector("#message")?.textContent || "").startsWith("Mix did not complete"), null, { timeout: 20000 });
  assert.match(await page.locator("#message").innerText(), /^Stereo WAV created\b/, "muted-music render should complete");
  const mutedMusicPcm = await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.querySelector("#mixPlayer").src)).arrayBuffer()).slice(44)));
  assert.deepEqual(mutedMusicPcm, flatEqPcm, "muting music should leave the dialogue-only mix unchanged");
  // Keep music muted so the pre-existing hard-left pan assertion isolates dialogue.

  assert.equal(await page.locator("#eqbass-dialogue").count(), 1, "dialogue bass EQ control should exist");
  assert.equal(await page.locator("#eqmid-dialogue").count(), 1, "dialogue mid EQ control should exist");
  assert.equal(await page.locator("#eqtreble-dialogue").count(), 1, "dialogue treble EQ control should exist");
  await page.locator("#eqbass-dialogue").evaluate(el => { el.value = "6"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.locator("#render").click();
  await page.waitForFunction(() => (document.querySelector("#message")?.textContent || "").startsWith("Stereo WAV created") || (document.querySelector("#message")?.textContent || "").startsWith("Mix did not complete"), null, { timeout: 20000 });
  assert.match(await page.locator("#message").innerText(), /^Stereo WAV created\b/, "EQ render failed");
  const eqPcm = await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch(document.querySelector("#mixPlayer").src)).arrayBuffer()).slice(44)));
  assert.notDeepEqual(eqPcm, flatEqPcm, "enabling bass EQ must alter rendered PCM");
  assert.match(await page.locator("#log").innerText(), /pcm_scan=PASS/);

  assert.equal(await page.locator("#pan-dialogue").count(), 1, "dialogue pan control should exist");
  await page.locator("#pan-dialogue").evaluate(el => { el.value = "-100"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.locator("#render").click();
  await page.waitForFunction(() => (document.querySelector("#message")?.textContent || "").startsWith("Stereo WAV created") || (document.querySelector("#message")?.textContent || "").startsWith("Mix did not complete"), null, { timeout: 20000 });
  assert.match(await page.locator("#message").innerText(), /^Stereo WAV created\b/, "pan render failed");
  const panCheck = await page.evaluate(async () => {
    const bytes = await (await fetch(document.querySelector("#mixPlayer").src)).arrayBuffer();
    const view = new DataView(bytes);
    let rightPeak = 0;
    for (let i = 46; i < bytes.byteLength; i += 4) rightPeak = Math.max(rightPeak, Math.abs(view.getInt16(i, true)));
    return { rightPeak, byteLength: bytes.byteLength };
  });
  assert.ok(panCheck.byteLength > 44, "panned WAV should contain PCM frames");
  assert.equal(panCheck.rightPeak, 0, "hard-left mono pan must leave the right channel silent");

  await page.locator("#solo-dialogue").click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#saveProject").click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /\.json$/i);
  const projectPath = await download.path();
  const project = JSON.parse(await readFile(projectPath, "utf8"));
  assert.equal(project.format, "OSD-WEB-PROJECT");
  assert.equal(project.projectVersion, 6);
  assert.equal(project.settings.dialogue.eqbass, 6, "project must preserve EQ settings");
  assert.equal(project.settings.dialogue.pan, -100, "project must preserve pan settings");
  assert.equal(project.settings.dialogue.solo, true, "project must preserve solo state");
  assert.equal(project.settings.dialogue.mute, false, "project must preserve mute state");
  assert.equal(project.settings.music.mute, true, "project must preserve mute state for every track");
  assert.ok(project.sources?.dialogue?.sha256, "project should record the source fingerprint");
  assert.equal(project.sources?.dialogue?.decoded, true);
  assert.ok(!Object.hasOwn(project, "audioData"), "project must not silently embed source audio");

  // Load the saved project back through the real file input and verify settings restore.
  await page.locator("#eqbass-dialogue").evaluate(el => { el.value = "0"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.locator("#pan-dialogue").evaluate(el => { el.value = "0"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.locator("#solo-dialogue").click();
  await page.locator("#mute-music").click();
  await page.locator("#loadProjectFile").setInputFiles({
    name: "osd-smoke-project.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project))
  });
  await page.waitForFunction(() => (document.querySelector("#message")?.textContent || "").startsWith("Project settings loaded") || (document.querySelector("#message")?.textContent || "").startsWith("Project load rejected"), null, { timeout: 10000 });
  assert.ok((await page.locator("#message").innerText()).startsWith("Project settings loaded"), "saved project should load successfully");
  assert.equal(await page.locator("#eqbass-dialogue").inputValue(), "6", "loading project should restore EQ");
  assert.equal(await page.locator("#pan-dialogue").inputValue(), "-100", "loading project should restore pan");
  assert.equal(await page.locator("#solo-dialogue").getAttribute("aria-pressed"), "true", "loading project should restore solo state");
  assert.equal(await page.locator("#mute-music").getAttribute("aria-pressed"), "true", "loading project should restore mute state");
  assert.match(await page.locator("#projectNotice").innerText(), /Audio was not embedded/, "load must clearly require relinking source audio");


  assert.deepEqual(errors, [], "uncaught page errors: " + errors.join("; "));
  console.log(JSON.stringify({
    status: "PASS",
    sourceImport: "PASS",
    preflightAndPostDecodeMemoryChecks: "PASS",
    stereoWavRenderAndSerializedPcmQc: "PASS",
    localPreview: "PASS",
    trackMuteSoloRenderAndProjectPersistence: "PASS",
    projectLoadRoundTrip: "PASS",
    projectJsonDownloadAndFingerprint: "PASS",
    uncaughtPageErrors: errors.length
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
