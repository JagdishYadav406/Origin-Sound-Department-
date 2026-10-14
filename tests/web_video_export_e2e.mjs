import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseUrl = process.env.OSD_BASE_URL || "http://127.0.0.1:4173/web/index.html";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const errors = [];
let fixtureDirectory = null;
page.on("pageerror", error => errors.push(error.message));

function makePcmWav(seconds, sampleRate = 44100, syncMarkers = []) {
  const frames = Math.floor(seconds * sampleRate);
  const dataBytes = frames * 2;
  const out = Buffer.alloc(44 + dataBytes);
  out.write("RIFF", 0); out.writeUInt32LE(36 + dataBytes, 4); out.write("WAVE", 8);
  out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22); out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * 2, 28); out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < frames; i++) {
    const time = i / sampleRate;
    let sample = 0;
    if (!syncMarkers.length) sample = Math.sin(2 * Math.PI * 330 * time) * 0.12;
    else for (const marker of syncMarkers) {
      const local = time - marker;
      if (Math.abs(local) < 0.05) {
        const envelope = Math.min(1, (local + 0.05) / 0.008, (0.05 - local) / 0.008);
        sample += Math.sin(2 * Math.PI * 330 * local) * 0.12 * Math.max(0, envelope);
      }
    }
    out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + i * 2);
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
    let running = true, recordingStart = 0;
    const syncMarkers = [0.4, 0.9, 1.4];
    const paint = () => {
      if (!running) return;
      const time = recordingStart ? (performance.now() - recordingStart) / 1000 : -1;
      const flash = syncMarkers.some(marker => Math.abs(time - marker) < 0.05);
      ctx.fillStyle = flash ? "#ffffff" : "#111827";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
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
    recordingStart = performance.now();
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

  // Use one real temporary file for every matching-source selection. Playwright's
  // in-memory file payload does not reliably preserve a caller-supplied mtime.
  fixtureDirectory = await mkdtemp(join(tmpdir(), "osd-picture-roundtrip-"));
  const fixturePath = join(fixtureDirectory, "osd-generated-video-fixture.webm");
  await writeFile(fixturePath, Buffer.from(fixture.base64, "base64"));
  const fixedTime = new Date(1700000000000);
  await utimes(fixturePath, fixedTime, fixedTime);
  const fixtureStat = await stat(fixturePath);
  const fixtureLastModified = Math.trunc(fixtureStat.mtimeMs);
  await page.locator("#referenceVideo").setInputFiles(fixturePath);
  await page.waitForFunction(() => (document.querySelector("#videoReferenceState")?.textContent || "").includes("Video metadata read by this browser"), null, { timeout: 15000 });
  const loadedDuration = await page.locator("#referenceVideoPlayer").evaluate(v => v.duration);
  assert.ok(Number.isFinite(loadedDuration) && Math.abs(loadedDuration - fixture.duration) < 0.1, "selected source video should retain readable duration");

  await page.locator("#file-dialogue").setInputFiles({
    name: "osd-export-test-dialogue.wav", mimeType: "audio/wav",
    buffer: makePcmWav(loadedDuration, 44100, [0.4, 0.9, 1.4])
  });
  await page.waitForFunction(() => (document.querySelector("#state-dialogue")?.textContent || "").startsWith("Ready"), null, { timeout: 15000 });
  await page.locator("#render").click();
  await page.waitForFunction(() => (document.querySelector("#mixPreviewStatus")?.textContent || "").endsWith("CURRENT"), null, { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector("#exportVideoMix")?.disabled, null, { timeout: 10000 });
  const beforeMute = await page.locator("#referenceVideoPlayer").evaluate(v => v.muted);
  const downloadPromise = page.waitForEvent("download", { timeout: 15000 }).then(download => ({ kind: "download", download }), error => ({ kind: "download-timeout", error: String(error.message || error) }));
  const qcFailurePromise = page.waitForFunction(() => {
    const status = document.querySelector("#videoMixExportStatus")?.textContent || "";
    return status.startsWith("Export rejected by QC:") || status.startsWith("Failed:") || status.startsWith("Rejected:");
  }, null, { timeout: 15000 }).then(async () => ({ kind: "qc-failure", status: await page.locator("#videoMixExportStatus").textContent().catch(() => "status unavailable") }), error => ({ kind: "qc-timeout", error: String(error.message || error) }));
  await page.locator("#exportVideoMix").click();
  const outcome = await Promise.race([downloadPromise, qcFailurePromise]);
  if (outcome.kind === "qc-failure") throw new Error("Export QC rejected the output: " + outcome.status);
  if (outcome.kind !== "download") throw new Error("Export produced no download and no explicit QC rejection: " + outcome.error);
  const download = outcome.download;
  assert.match(download.suggestedFilename(), /-OSD-mix\.webm$/, "export must download a new WebM rather than overwrite the source");
  const stream = await download.createReadStream();
  const parts = [];
  for await (const part of stream) parts.push(part);
  const output = Buffer.concat(parts);
  assert.ok(output.length > 1000, "exported WebM must not be empty");
  assert.deepEqual([...output.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3], "output should start with the WebM EBML signature");
  const outputMetrics = await page.evaluate(async ({ base64 }) => {
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
    await video.play();
    await new Promise(resolve => setTimeout(resolve, 150));
    const tracks = { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
    video.pause();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Web Audio decoder unavailable for output verification");
    const audioContext = new AudioContextClass();
    const audioBuffer = await audioContext.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    tracks.audioDecodedSeconds = audioBuffer.duration;
    tracks.audioChannels = audioBuffer.numberOfChannels;
    const channel = audioBuffer.getChannelData(0);
    const binSeconds = 0.01, binFrames = Math.max(1, Math.floor(audioBuffer.sampleRate * binSeconds)), rmsBins = [];
    for (let start = 0; start < channel.length; start += binFrames) {
      let sum = 0, count = Math.min(binFrames, channel.length - start);
      for (let j = 0; j < count; j++) sum += channel[start + j] * channel[start + j];
      rmsBins.push({ time: (start + count / 2) / audioBuffer.sampleRate, rms: Math.sqrt(sum / count) });
    }
    tracks.audioMarkerPeaksSeconds = [0.4, 0.9, 1.4].map(marker => {
      const window = rmsBins.filter(bin => Math.abs(bin.time - marker) <= 0.2);
      if (!window.length) throw new Error("No decoded audio samples around sync marker " + marker);
      return window.reduce((best, bin) => bin.rms > best.rms ? bin : best).time;
    });
    video.pause();
    await new Promise((resolve, reject) => {
      const finish = () => { clearTimeout(timeout); resolve(); };
      const timeout = setTimeout(() => { video.removeEventListener("seeked", finish); reject(new Error("Timed out resetting exported video for sync-marker analysis")); }, 3000);
      if (video.currentTime === 0 && video.readyState >= 2) { finish(); return; }
      video.addEventListener("seeked", finish, { once: true });
      video.currentTime = 0;
    });
    const markerCanvas = document.createElement("canvas");
    markerCanvas.width = video.videoWidth; markerCanvas.height = video.videoHeight;
    const markerContext = markerCanvas.getContext("2d", { willReadFrequently: true });
    tracks.videoFlashGroupsSeconds = [];
    await video.play();
    await new Promise((resolve, reject) => {
      let finished = false, lastFlash = -Infinity, group = null;
      const finish = () => {
        if (finished) return;
        finished = true; clearTimeout(timeout); video.removeEventListener("ended", finish);
        if (group) tracks.videoFlashGroupsSeconds.push((group.first + group.last) / 2);
        resolve();
      };
      const timeout = setTimeout(() => { if (finished) return; video.pause(); reject(new Error("Timed out decoding exported video sync markers")); }, 6000);
      video.addEventListener("ended", finish, { once: true });
      const frame = (_now, metadata) => {
        if (finished) return;
        markerContext.drawImage(video, 0, 0, markerCanvas.width, markerCanvas.height);
        const pixel = markerContext.getImageData(Math.floor(markerCanvas.width / 2), Math.floor(markerCanvas.height / 2), 1, 1).data;
        const isFlash = pixel[0] > 220 && pixel[1] > 220 && pixel[2] > 220;
        if (isFlash) {
          if (!group || metadata.mediaTime - lastFlash > 0.12) {
            if (group) tracks.videoFlashGroupsSeconds.push((group.first + group.last) / 2);
            group = { first: metadata.mediaTime, last: metadata.mediaTime };
          } else group.last = metadata.mediaTime;
          lastFlash = metadata.mediaTime;
        }
        if (video.ended) { finish(); return; }
        video.requestVideoFrameCallback(frame);
      };
      video.requestVideoFrameCallback(frame);
    });
    if (tracks.videoFlashGroupsSeconds.length !== 3) throw new Error("Expected three decoded video sync flashes: " + JSON.stringify(tracks.videoFlashGroupsSeconds));
    tracks.syncMarkerOffsetsSeconds = tracks.videoFlashGroupsSeconds.map((time, index) => Math.abs(time - tracks.audioMarkerPeaksSeconds[index]));
    if (tracks.syncMarkerOffsetsSeconds.some(offset => offset > 0.15)) throw new Error("Audio/video sync marker offset exceeded 150 ms: " + JSON.stringify({ video: tracks.videoFlashGroupsSeconds, audio: tracks.audioMarkerPeaksSeconds, offsets: tracks.syncMarkerOffsetsSeconds }));
    await audioContext.close();
    if (tracks.width <= 0 || tracks.height <= 0 || !Number.isFinite(tracks.duration) || tracks.duration <= 0) throw new Error("Exported WebM video stream did not decode: " + JSON.stringify(tracks));
    if (!Number.isFinite(tracks.audioDecodedSeconds) || tracks.audioDecodedSeconds <= 0 || tracks.audioChannels < 1) throw new Error("Exported WebM audio stream did not decode: " + JSON.stringify(tracks));
    if (Math.abs(tracks.duration - Number(document.querySelector("#referenceVideoPlayer").duration)) > 0.35) throw new Error("Exported video duration drifted beyond 0.35 seconds: " + JSON.stringify(tracks));
    if (Math.abs(tracks.duration - tracks.audioDecodedSeconds) > 0.35) throw new Error("Exported video/audio stream durations differ by more than 0.35 seconds; this is a duration sanity check, not proof of frame-level synchronization: " + JSON.stringify(tracks));
    return tracks;
  }, { base64: output.toString("base64") });
  assert.equal(outputMetrics.syncMarkerOffsetsSeconds.length, 3, "three audio/video sync markers must be measured");
  assert.ok(Math.max(...outputMetrics.syncMarkerOffsetsSeconds) <= 0.15, "audio/video sync markers must remain within 150 ms: " + JSON.stringify(outputMetrics));
  await page.waitForFunction(() => (document.querySelector("#videoMixExportStatus")?.textContent || "").includes("WebM prepared"), null, { timeout: 5000 });
  const afterMute = await page.locator("#referenceVideoPlayer").evaluate(v => v.muted);
  assert.equal(afterMute, beforeMute, "export cleanup must restore source video mute state");
  // Exercise a real cut export: split the source at 0.5 s, remove the first
  // interval, and verify the new WebM contains both video and sliced mix audio.
  await page.locator("#buildPictureTimeline").click();
  await page.locator("#referenceVideoPlayer").evaluate(v => { v.currentTime = 0.5; });
  await page.waitForFunction(() => !document.querySelector("#splitPictureAtPlayhead")?.disabled, null, { timeout: 5000 });
  await page.locator("#splitPictureAtPlayhead").click();
  assert.equal(await page.locator("#pictureTimelineList .cue-row").count(), 2, "splitting at playhead should create two retained intervals");
  await page.locator("#pictureTimelineList .cue-row").first().getByRole("button", { name: /Remove picture interval/ }).click();
  assert.equal(await page.locator("#pictureTimelineList .cue-row").count(), 1, "removing interval should leave the selected output segment");
  await page.locator("#undoPictureEdit").click();
  assert.equal(await page.locator("#pictureTimelineList .cue-row").count(), 2, "undo should restore the removed interval");
  await page.locator("#pictureTimelineList .cue-row").first().getByRole("button", { name: /Remove picture interval/ }).click();
  assert.equal(await page.locator("#pictureTimelineList .cue-row").count(), 1, "reapplying the removal should leave one output interval");
  const cutDownloadPromise = page.waitForEvent("download", { timeout: 15000 });
  await page.locator("#exportPictureEdits").click();
  const cutDownload = await cutDownloadPromise;
  assert.match(cutDownload.suggestedFilename(), /-OSD-picture-edits\.webm$/, "picture edit should export as a separate file");
  const cutStream = await cutDownload.createReadStream();
  const cutParts = [];
  for await (const part of cutStream) cutParts.push(part);
  const cutOutput = Buffer.concat(cutParts);
  assert.ok(cutOutput.length > 1000, "edited WebM should contain encoded output");
  const cutTracks = await page.evaluate(async ({ base64 }) => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const video = document.createElement("video"); video.muted = true; video.src = URL.createObjectURL(new Blob([bytes], { type: "video/webm" }));
    document.body.appendChild(video);
    await new Promise((resolve, reject) => { video.addEventListener("loadedmetadata", resolve, { once: true }); video.addEventListener("error", () => reject(new Error("Cut WebM failed to decode")), { once: true }); video.load(); });
    await video.play(); await new Promise(resolve => setTimeout(resolve, 150));
    const result = { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
    video.pause();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext; const ac = new AudioContextClass();
    const audio = await ac.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    result.audioDuration = audio.duration; result.audioChannels = audio.numberOfChannels;
    await ac.close(); URL.revokeObjectURL(video.src); video.remove(); return result;
  }, { base64: cutOutput.toString("base64") });
  assert.ok(cutTracks.width > 0 && cutTracks.height > 0, "cut WebM must decode a video stream");
  assert.ok(cutTracks.audioDuration > 0 && cutTracks.audioChannels >= 1, "cut WebM must decode matching mix audio");
  assert.ok(Math.abs(cutTracks.duration - cutTracks.audioDuration) <= 0.35, "cut WebM video/audio durations must align within 0.35 seconds (duration sanity check only): " + JSON.stringify(cutTracks));
  assert.ok(cutTracks.duration < loadedDuration - 0.2 && cutTracks.duration > loadedDuration - 0.8, "cut WebM duration should reflect the removed source interval: " + JSON.stringify(cutTracks));
  await page.waitForFunction(() => (document.querySelector("#pictureTimelineStatus")?.textContent || "").includes("Edited WebM prepared"), null, { timeout: 5000 });

  // Exercise project persistence: the content fingerprint, not filename/mtime, governs restoration.
  const projectDownloadPromise = page.waitForEvent("download", { timeout: 10000 });
  await page.locator("#saveProject").click();
  const projectDownload = await projectDownloadPromise;
  assert.match(projectDownload.suggestedFilename(), /OSD-project-.*\.json$/, "project save should produce a JSON file");
  const projectStream = await projectDownload.createReadStream();
  const projectParts = [];
  for await (const part of projectStream) projectParts.push(part);
  const projectBytes = Buffer.concat(projectParts);
  const savedProject = JSON.parse(projectBytes.toString("utf8"));
  assert.equal(savedProject.projectVersion, 13, "picture timeline project schema should be v13");
  assert.match(savedProject.pictureTimeline.source?.fingerprint || "", /^[a-f0-9]{64}$/i, "saved picture timeline must include a content fingerprint");
  assert.equal(savedProject.pictureTimeline.source?.fingerprintAlgorithm, "OSD-CHUNKED-SHA256-V1", "saved fingerprint algorithm must be explicit");
  assert.equal(savedProject.pictureTimeline.segments.length, 1, "saved project should preserve the selected picture interval");
  assert.deepEqual(
    { name: savedProject.pictureTimeline.source?.name, size: savedProject.pictureTimeline.source?.size, lastModified: savedProject.pictureTimeline.source?.lastModified },
    { name: "osd-generated-video-fixture.webm", size: Buffer.from(fixture.base64, "base64").length, lastModified: fixtureLastModified },
    "saved picture timeline must include the reference-video identity needed for safe restoration"
  );
  assert.ok(Math.abs(savedProject.pictureTimeline.segments[0].start - 0.5) < 0.15, "saved picture interval should preserve its cut start");
  assert.ok(Math.abs(savedProject.pictureTimeline.segments[0].end - loadedDuration) < 0.15, "saved picture interval should preserve its cut end");
  await page.locator("#loadProjectFile").setInputFiles({ name: "osd-roundtrip-project.json", mimeType: "application/json", buffer: projectBytes });
  await page.waitForFunction(() => (document.querySelector("#videoReferenceState")?.textContent || "").includes("Re-select it to preview"), null, { timeout: 5000 });
  await page.locator("#referenceVideo").setInputFiles([]);
  await page.locator("#referenceVideo").setInputFiles(fixturePath);
  await page.waitForFunction(() => {
    const video = document.querySelector("#referenceVideoPlayer");
    return video && video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0;
  }, null, { timeout: 10000 });
  await page.waitForFunction(() => (document.querySelector("#log")?.textContent || "").includes("PICTURE_TIMELINE_RESTORED identity=content_fingerprint algorithm=OSD-CHUNKED-SHA256-V1"), null, { timeout: 10000 }).catch(async () => {
    const diagnostic = await page.evaluate(() => ({
      status: document.querySelector("#pictureTimelineStatus")?.textContent || "",
      state: document.querySelector("#videoReferenceState")?.textContent || "",
      duration: document.querySelector("#referenceVideoPlayer")?.duration,
      log: (document.querySelector("#log")?.textContent || "").slice(-2500)
    }));
    throw new Error("Matching source metadata did not restore the saved picture timeline: " + JSON.stringify(diagnostic));
  });
  assert.equal(await page.locator("#pictureTimelineList .cue-row").count(), 1, "matching video content should restore the saved interval");
  // The same bytes under a different filename and mtime must still match by content.
  await page.locator("#loadProjectFile").setInputFiles({ name: "osd-roundtrip-project.json", mimeType: "application/json", buffer: projectBytes });
  await page.waitForFunction(() => (document.querySelector("#videoReferenceState")?.textContent || "").includes("Re-select it to preview"), null, { timeout: 5000 });
  await page.locator("#referenceVideo").setInputFiles([]);
  await page.locator("#referenceVideo").setInputFiles({name:"renamed-same-content.webm",mimeType:"video/webm",lastModified:1700000000000,buffer:Buffer.from(fixture.base64,"base64")});
  await page.waitForFunction(() => (document.querySelector("#videoReferenceState")?.textContent || "").includes("Video metadata read by this browser"), null, { timeout: 10000 });
  await page.waitForFunction(() => (document.querySelector("#log")?.textContent || "").includes("PICTURE_TIMELINE_RESTORED identity=content_fingerprint algorithm=OSD-CHUNKED-SHA256-V1"), null, { timeout: 10000 });
  assert.equal(await page.locator("#pictureTimelineList .cue-row").count(), 1, "renamed identical content should restore the saved interval");
  // Reload the saved project so a pending restore decision exists for the
  // mismatched-source case. A successful restore consumes that pending decision.
  await page.locator("#loadProjectFile").setInputFiles({ name: "osd-roundtrip-project.json", mimeType: "application/json", buffer: projectBytes });
  await page.waitForFunction(() => (document.querySelector("#videoReferenceState")?.textContent || "").includes("Re-select it to preview"), null, { timeout: 5000 });
  const mismatchedSource = Buffer.from(fixture.base64, "base64");
  // Change bytes while preserving filename, byte count, and mtime. Alter a payload byte
  // rather than container length so metadata-based identity would be fooled.
  mismatchedSource[Math.floor(mismatchedSource.length * 0.55)] ^= 0x01;
  await page.locator("#referenceVideo").setInputFiles({
    name: "osd-generated-video-fixture.webm", mimeType: "video/webm", lastModified: fixtureLastModified,
    buffer: mismatchedSource
  });
  await page.waitForFunction(() => (document.querySelector("#videoReferenceState")?.textContent || "").includes("Video metadata read by this browser"), null, { timeout: 10000 });
  await page.waitForFunction(() => (document.querySelector("#log")?.textContent || "").includes("PICTURE_TIMELINE_RESTORE_BLOCKED source_identity_mismatch=true"), null, { timeout: 10000 });
  assert.equal(await page.locator("#pictureTimelineList .cue-row").count(), 0, "different content with matching basic metadata must not inherit old picture cuts");
  assert.deepEqual(errors, [], "uncaught page errors: " + errors.join("; "));
  console.log(JSON.stringify({ status: "PASS", realGeneratedVideoFixture: "PASS", realWavRender: "PASS", explicitWebmDownload: "PASS", exportedWebmMetadataAndDecode: "PASS", outputContainsVideoAndAudioTracks: "PASS", outputDurationChecked: "PASS", decodedAudioVideoSyncMarkers: "PASS", syncMarkerOffsetsSeconds: outputMetrics.syncMarkerOffsetsSeconds, sourceMuteStateRestored: "PASS", outputBytes: output.length, fixtureDurationSeconds: fixture.duration }, null, 2));
} finally {
  await context.close();
  await browser.close();
  if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
}
