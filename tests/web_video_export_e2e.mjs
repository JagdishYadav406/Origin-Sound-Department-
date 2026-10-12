import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.OSD_BASE_URL || "http://127.0.0.1:4173/web/index.html";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));

function makePcmWav(seconds, sampleRate = 44100) {
  const frames = Math.floor(seconds * sampleRate);
  const dataBytes = frames * 2;
  const out = Buffer.alloc(44 + dataBytes);
  out.write("RIFF", 0); out.writeUInt32LE(36 + dataBytes, 4); out.write("WAVE", 8);
  out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22); out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28); out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < frames; i++) {
    out.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 330 * i / sampleRate) * 0.12 * 32767), 44 + i * 2);
  }
  return out;
}

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const fixture = await page.evaluate(async () => {
    if (typeof MediaRecorder === "undefined" || !HTMLCanvasElement.prototype.captureStream) {
      throw new Error("Chromium does not support MediaRecorder/canvas capture required for real-media export test");
    }
    const canvas = document.createElement("canvas"); canvas.width = 160; canvas.height = 90;
    const ctx = canvas.getContext("2d");
    let frame = 0, running = true;
    const paint = () => {
      if (!running) return;
      ctx.fillStyle = frame++ % 2 ? "#14532d" : "#1d4ed8";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#ffffff"; ctx.fillRect((frame * 7) % 140, 35, 20, 20);
      requestAnimationFrame(paint);
    };
    paint();
    const stream = canvas.captureStream(24);
    const types = ["video/webm;codecs=vp8", "video/webm"];
    const mime = types.find(t => MediaRecorder.isTypeSupported(t)) || "";
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    const chunks = [];
    recorder.addEventListener("dataavailable", e => { if (e.data?.size) chunks.push(e.data); });
    const stopped = new Promise(resolve => recorder.addEventListener("stop", resolve, { once: true }));
    recorder.start(200);
    await new Promise(resolve => setTimeout(resolve, 2000));
    running = false; recorder.stop(); await stopped; stream.getTracks().forEach(t => t.stop());
    const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
    const url = URL.createObjectURL(blob);
    const probe = document.createElement("video"); probe.muted = true; probe.src = url;
    await new Promise((resolve, reject) => {
      probe.addEventListener("loadedmetadata", resolve, { once: true });
      probe.addEventListener("error", () => reject(new Error("Generated video fixture failed to decode")), { once: true });
      probe.load();
    });
    if (!Number.isFinite(probe.duration) || probe.duration <= 0) {
      await new Promise(resolve => {
        let done = false;
        const finish = () => { if (done) return; done = true; clearTimeout(timer); probe.removeEventListener("seeked", finish); resolve(); };
        const timer = setTimeout(finish, 1800);
        probe.addEventListener("seeked", finish, { once: true });
        try { probe.currentTime = 1e101; } catch { finish(); }
      });
    }
    const result = { base64: await blob.arrayBuffer().then(b => { const bytes = new Uint8Array(b); let binary = ""; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(binary); }), duration: probe.duration, width: probe.videoWidth, height: probe.videoHeight, bytes: blob.size, mime: blob.type };
    URL.revokeObjectURL(url);
    return result;
  });
  assert.ok(fixture.bytes > 1000, "real generated WebM fixture should contain encoded video bytes");
  assert.ok(Number.isFinite(fixture.duration) && fixture.duration >= 1.5 && fixture.duration <= 3, "fixture video duration must be readable and bounded: " + JSON.stringify({ ...fixture, base64: undefined }));
  assert.ok(fixture.width > 0 && fixture.height > 0, "fixture video must decode to real dimensions");

  await page.locator("#referenceVideo").setInputFiles({
    name: "osd-generated-video-fixture.webm", mimeType: "video/webm",
    buffer: Buffer.from(fixture.base64, "base64")
  });
  await page.waitForFunction(() => (document.querySelector("#videoReferenceState")?.textContent || "").includes("Video metadata read by this browser"), null, { timeout: 15000 });
  const loadedDuration = await page.locator("#referenceVideoPlayer").evaluate(v => v.duration);
  assert.ok(Number.isFinite(loadedDuration) && Math.abs(loadedDuration - fixture.duration) < 0.1, "selected source video should retain readable duration");

  await page.locator("#file-dialogue").setInputFiles({
    name: "osd-export-test-dialogue.wav", mimeType: "audio/wav",
    buffer: makePcmWav(loadedDuration)
  });
  await page.waitForFunction(() => (document.querySelector("#state-dialogue")?.textContent || "").startsWith("Ready"), null, { timeout: 15000 });
  await page.locator("#render").click();
  await page.waitForFunction(() => (document.querySelector("#mixPreviewStatus")?.textContent || "").endsWith("CURRENT"), null, { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector("#exportVideoMix")?.disabled, null, { timeout: 10000 });
  const beforeMute = await page.locator("#referenceVideoPlayer").evaluate(v => v.muted);
  const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
  await page.locator("#exportVideoMix").click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /-OSD-mix\.webm$/, "export must download a new WebM rather than overwrite the source");
  const stream = await download.createReadStream();
  const parts = [];
  for await (const part of stream) parts.push(part);
  const output = Buffer.concat(parts);
  assert.ok(output.length > 1000, "exported WebM must not be empty");
  assert.deepEqual([...output.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3], "output should start with the WebM EBML signature");
  await page.evaluate(async ({ base64 }) => {
    const binary = atob(base64); const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    const video = document.createElement("video"); video.id = "osd-export-output-probe"; video.muted = true; video.playsInline = true;
    video.src = URL.createObjectURL(new Blob([bytes], { type: "video/webm" }));
    document.body.appendChild(video);
    await new Promise((resolve, reject) => {
      video.addEventListener("loadedmetadata", resolve, { once: true });
      video.addEventListener("error", () => reject(new Error("Exported WebM failed to load metadata/decode")), { once: true });
      video.load();
    });
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      await new Promise(resolve => {
        let done = false;
        const finish = () => { if (done) return; done = true; clearTimeout(timer); video.removeEventListener("seeked", finish); resolve(); };
        const timer = setTimeout(finish, 1800);
        video.addEventListener("seeked", finish, { once: true });
        try { video.currentTime = 1e101; } catch { finish(); }
      });
    }
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.videoWidth <= 0 || video.videoHeight <= 0) throw new Error("Exported WebM has invalid media metadata after end-seek duration resolution");
    const stream = video.captureStream();
    await video.play();
    await new Promise(resolve => setTimeout(resolve, 150));
    const tracks = { video: stream.getVideoTracks().length, audio: stream.getAudioTracks().length, duration: video.duration, width: video.videoWidth, height: video.videoHeight };
    video.pause(); stream.getTracks().forEach(t => t.stop());
    if (tracks.video < 1 || tracks.audio < 1) throw new Error("Exported WebM must contain both video and mixed-audio tracks: " + JSON.stringify(tracks));
    if (Math.abs(tracks.duration - Number(document.querySelector("#referenceVideoPlayer").duration)) > 0.35) throw new Error("Exported video duration drifted beyond 0.35 seconds: " + JSON.stringify(tracks));
    return tracks;
  }, { base64: output.toString("base64") });
  await page.waitForFunction(() => (document.querySelector("#videoMixExportStatus")?.textContent || "").includes("WebM prepared"), null, { timeout: 5000 });
  const afterMute = await page.locator("#referenceVideoPlayer").evaluate(v => v.muted);
  assert.equal(afterMute, beforeMute, "export cleanup must restore source video mute state");
  assert.deepEqual(errors, [], "uncaught page errors: " + errors.join("; "));
  console.log(JSON.stringify({ status: "PASS", realGeneratedVideoFixture: "PASS", realWavRender: "PASS", explicitWebmDownload: "PASS", exportedWebmMetadataAndDecode: "PASS", outputContainsVideoAndAudioTracks: "PASS", outputDurationChecked: "PASS", sourceMuteStateRestored: "PASS", outputBytes: output.length, fixtureDurationSeconds: fixture.duration }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
