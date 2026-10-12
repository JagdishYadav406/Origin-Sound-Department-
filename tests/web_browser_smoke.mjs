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
  await page.locator("#aiServiceUrl").fill("not a valid url");
  await page.locator("#testAIConnection").click();
  assert.match(await page.locator("#aiConnectionStatus").innerText(), /^Connection not tested:/, "invalid AI service URL must fail honestly");
  await page.locator("#aiServiceUrl").fill("");

  // Exercise the actual browser-to-service visual-analysis contract with a deterministic mock backend.
  // This proves UI wiring and payload/response handling without provider credentials or API charges.
  const mockAiAnalysis = {
    summary: "Mock integration: calm opening with room for a restrained musical bed.",
    scenes: [{
      start_seconds: 0, end_seconds: 1,
      description: "A test frame with visible movement.",
      visible_evidence: "A generated test video frame is present.",
      mood: "calm", energy: "low", confidence: 0.8
    }],
    cues: [{
      category: "music", start_seconds: 0, end_seconds: 1,
      description: "Use a restrained musical bed.",
      rationale: "Mock integration response used to verify the cue review UI.",
      confidence: 0.75, search_terms: ["restrained underscore", "soft cinematic bed"]
    }],
    limitations: ["Mock response only; this is not a real AI model result."]
  };
  let observedVisualRequest = null;
  const pageOrigin = new URL(baseUrl).origin;
  await page.route("https://mock-osd-ai.example/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const cors = {
      "access-control-allow-origin": pageOrigin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "Content-Type,Authorization",
      "content-type": "application/json",
      "cache-control": "no-store"
    };
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors, body: "" });
      return;
    }
    if (request.method() === "GET" && url.pathname === "/v1/health") {
      await route.fulfill({ status: 200, headers: cors, body: JSON.stringify({
        status: "ok", configured: true, model: "mock-vision-model",
        audioModel: "mock-audio-model", limits: { maxDurationSeconds: 600, maxFrames: 12 }
      }) });
      return;
    }
    if (request.method() === "POST" && url.pathname === "/v1/analyze-audio") {
      assert.equal(request.headers()["authorization"], "Bearer mock-service-token");
      const audioBody = request.postDataJSON();
      assert.ok(audioBody.durationSeconds > 0 && audioBody.durationSeconds <= 90);
      assert.match(audioBody.audioDataUrl, /^data:audio\/(wav|mpeg);base64,/);
      await route.fulfill({ status: 200, headers: cors, body: JSON.stringify({
        requestId: "mock-audio-request-1", status: "completed", model: "mock-audio-model",
        method: "audio-aware-model", durationSeconds: audioBody.durationSeconds,
        coverage: "audio input analyzed; timestamps are model estimates and must be reviewed",
        analysis: {
          ...mockAiAnalysis,
          summary: "Mock audio integration: speech with a restrained musical bed.",
          scenes: [{ ...mockAiAnalysis.scenes[0], description: "Speech over a continuous tonal bed.", visible_evidence: "AUDIBLE evidence: speech and a tonal bed are present." }],
          cues: [{ ...mockAiAnalysis.cues[0], description: "Keep background music below the narration.", rationale: "Mock audio response verifies the audio-aware UI path." }],
          limitations: ["Mock response only; this is not a real AI model result."]
        }
      }) });
      return;
    }
    if (request.method() === "POST" && url.pathname === "/v1/analyze") {
      assert.equal(request.headers()["authorization"], "Bearer mock-service-token");
      observedVisualRequest = request.postDataJSON();
      await route.fulfill({ status: 200, headers: cors, body: JSON.stringify({
        requestId: "mock-request-1", status: "completed", model: "mock-vision-model",
        method: "sampled-frame-vision", durationSeconds: observedVisualRequest.durationSeconds,
        sampledFrameTimesSeconds: observedVisualRequest.frames.map(frame => frame.timestampSeconds),
        coverage: "sparse sampled frames only; audio was not analyzed",
        analysis: mockAiAnalysis
      }) });
      return;
    }
    await route.fulfill({ status: 404, headers: cors, body: JSON.stringify({ error: "Unexpected mock endpoint" }) });
  });

  const videoBase64 = await page.evaluate(async () => {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      throw new Error("Chromium test environment lacks canvas MediaRecorder support");
    }
    const canvas = document.createElement("canvas");
    canvas.width = 160; canvas.height = 90;
    const ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(8);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
    const chunks = [];
    recorder.addEventListener("dataavailable", event => { if (event.data.size) chunks.push(event.data); });
    const stopped = new Promise(resolve => recorder.addEventListener("stop", resolve, { once: true }));
    recorder.start();
    const started = performance.now();
    await new Promise(resolve => {
      const draw = now => {
        ctx.fillStyle = now - started < 650 ? "#163b25" : "#315b8a";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(Math.floor((now - started) % 100), 20, 20, 20);
        if (now - started < 1400) requestAnimationFrame(draw);
        else { recorder.stop(); stream.getTracks().forEach(track => track.stop()); resolve(); }
      };
      requestAnimationFrame(draw);
    });
    await stopped;
    const blob = new Blob(chunks, { type: "video/webm" });
    if (blob.size < 100) throw new Error("Generated smoke-test video is unexpectedly empty");
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not encode generated smoke-test video"));
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.readAsDataURL(blob);
    });
  });
  await page.locator("#referenceVideo").setInputFiles({
    name: "osd-ai-contract-smoke.webm",
    mimeType: "video/webm",
    buffer: Buffer.from(videoBase64, "base64")
  });
  await page.waitForFunction(() => {
    const player = document.querySelector("#referenceVideoPlayer");
    const state = document.querySelector("#videoReferenceState")?.textContent || "";
    return (player && Number.isFinite(player.duration) && player.duration > 0 && player.videoWidth > 0 && player.videoHeight > 0)
      || state.includes("could not read the video metadata");
  }, null, { timeout: 15000 });
  const videoReadiness = await page.evaluate(() => ({
    duration: document.querySelector("#referenceVideoPlayer")?.duration,
    width: document.querySelector("#referenceVideoPlayer")?.videoWidth,
    height: document.querySelector("#referenceVideoPlayer")?.videoHeight,
    state: document.querySelector("#videoReferenceState")?.textContent
  }));
  assert.ok(Number.isFinite(videoReadiness.duration) && videoReadiness.duration > 0 && videoReadiness.width > 0 && videoReadiness.height > 0,
    "generated WebM fixture must decode before AI integration test: " + JSON.stringify(videoReadiness));
  await page.waitForFunction(() => {
    const button = document.querySelector("#analyzeVideoAI");
    return button && !button.disabled;
  }, null, { timeout: 15000 });
    await page.locator("#aiServiceUrl").fill("https://mock-osd-ai.example");
  await page.locator("#aiServiceToken").fill("mock-service-token");
  await page.locator("#testAIConnection").click();
  await page.waitForFunction(() => (document.querySelector("#aiConnectionStatus")?.textContent || "").includes("Service reachable and configured"), null, { timeout: 5000 });
  await page.locator("#aiUploadConsent").check();
  await page.locator("#analyzeVideoAI").click();
  await page.waitForFunction(() => (document.querySelector("#aiAnalysisStatus")?.textContent || "").includes("Analysis complete"), null, { timeout: 15000 });
  assert.ok(observedVisualRequest, "the frontend must POST the sampled frames to /v1/analyze");
  assert.ok(observedVisualRequest.frames.length >= 1 && observedVisualRequest.frames.length <= 8, "the frontend must send a bounded sample of at most eight frames");
  assert.ok(observedVisualRequest.frames.every(frame => /^data:image\/jpeg;base64,/.test(frame.imageDataUrl)), "frames must be resized JPEG data URLs");
  assert.ok(observedVisualRequest.frames.every(frame => Number.isFinite(frame.timestampSeconds) && frame.timestampSeconds >= 0 && frame.timestampSeconds <= observedVisualRequest.durationSeconds), "frame timestamps must stay within the selected video duration");
  assert.match(await page.locator("#aiAnalysisResults").innerText(), /Mock integration: calm opening/);
  assert.match(await page.locator("#aiAnalysisResults").innerText(), /restrained musical bed/);
  assert.equal(await page.locator("#exportAIPlanJSON").isEnabled(), true);
  assert.equal(await page.locator("#exportAICuesCSV").isEnabled(), true);

  // Verify the separate, explicitly consented audio-aware request path as well.
  await page.locator("#aiAudioFile").setInputFiles({
    name: "osd-ai-audio-contract-smoke.wav",
    mimeType: "audio/wav",
    buffer: makePcmWav({ seconds: 0.5, frequency: 220, amplitude: 0.04 })
  });
  await page.locator("#aiAudioConsent").check();
  await page.locator("#analyzeAudioAI").click();
  await page.waitForFunction(() => (document.querySelector("#audioAIStatus")?.textContent || "").includes("Audio analysis complete"), null, { timeout: 15000 });
  assert.match(await page.locator("#aiAnalysisResults").innerText(), /Mock audio integration: speech/);
  assert.match(await page.locator("#aiAnalysisResults").innerText(), /Keep background music below the narration/);
  await page.unroute("https://mock-osd-ai.example/**");


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
  assert.match(await page.locator("#mixPreviewStatus").innerText(), /CURRENT$/, "successful render should be marked current");
  await page.locator("#masterGain").evaluate(el => {
    el.value = String(Number(el.value) - 1);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.match(await page.locator("#mixPreviewStatus").innerText(), /OUTDATED$/, "changing master gain must mark prior preview outdated");
  assert.match(await page.locator("#mixPreviewNotice").innerText(), /previous completed render/i, "outdated preview must explain it is the previous render");
  await page.locator("#render").click();
  await page.waitForFunction(() => document.querySelector("#mixPreviewStatus")?.textContent?.endsWith("CURRENT"), null, { timeout: 20000 });
  assert.match(await page.locator("#qcMetric").innerText(), /PCM STRUCTURE PASS/, "rerender should complete validation before preview is current");
  assert.equal(await page.locator("#mixPreviewStatus").innerText(), "Latest completed render — CURRENT");
  assert.equal(await page.locator("#mixPreview").getAttribute("class"), "");
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
  await page.locator("#gateThreshold-dialogue").fill("-48");
  await page.locator("#gateReduction-dialogue").fill("12");
  assert.equal(await page.locator("#gateReductionout-dialogue").innerText(), "12 dB");
  await page.locator("#extraClipTrack").selectOption("dialogue");
  await page.locator("#extraClipOffset").fill("0.2");
  await page.locator("#extraClipGain").fill("-6");
  await page.locator("#extraClipFile").setInputFiles({
    name: "osd-smoke-extra-clip.wav",
    mimeType: "audio/wav",
    buffer: makePcmWav({ seconds: 0.5, frequency: 660, amplitude: 0.05 })
  });
  await page.waitForFunction(() => (document.querySelector("#extraClipStatus")?.textContent || "").startsWith("Added "), null, { timeout: 20000 });
  assert.equal(await page.locator("#extraClipList button").count(), 1, "additional clip should appear in the timeline");
  await page.locator("#render").click();
  await page.waitForFunction(() => (document.querySelector("#message")?.textContent || "").startsWith("Stereo WAV created") || (document.querySelector("#message")?.textContent || "").startsWith("Mix did not complete"), null, { timeout: 20000 });
  assert.match(await page.locator("#message").innerText(), /^Stereo WAV created\b/, "render including an extra clip should succeed");
  const clipRenderBytes = await page.evaluate(async () => (await (await fetch(document.querySelector("#mixPlayer").src)).arrayBuffer()).byteLength);
  assert.ok(clipRenderBytes > panCheck.byteLength, "an offset clip should extend the rendered WAV duration");
  await page.locator("#extraClipList button").click();
  assert.equal(await page.locator("#extraClipList button").count(), 0, "removing a clip should remove only that timeline entry");
  await page.locator("#render").click();
  await page.waitForFunction(() => (document.querySelector("#message")?.textContent || "").startsWith("Stereo WAV created") || (document.querySelector("#message")?.textContent || "").startsWith("Mix did not complete"), null, { timeout: 20000 });
  assert.match(await page.locator("#message").innerText(), /^Stereo WAV created\b/, "render after clip removal should succeed");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#saveProject").click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /\.json$/i);
  const projectPath = await download.path();
  const project = JSON.parse(await readFile(projectPath, "utf8"));
  assert.equal(project.format, "OSD-WEB-PROJECT");
  assert.equal(project.projectVersion, 11);
  assert.equal(project.timelineClips?.length, 0, "project should record an empty clip manifest when no extra clips are loaded");
  assert.equal(project.master.duckDepthDb, 0, 'dialogue ducking must default to off');
  assert.equal(project.master.duckThresholdDb, -30, 'project must preserve the ducking threshold');
  assert.equal(project.settings.dialogue.hpf, 80, "project must preserve the dialogue high-pass filter");
  assert.equal(project.settings.dialogue.compthresh, -18, "project must preserve compressor threshold");
  assert.equal(project.settings.dialogue.compratio, 3, "project must preserve compressor ratio");
  assert.equal(project.settings.dialogue.gateThreshold, -48, "project must preserve gate threshold");
  assert.equal(project.settings.dialogue.gateReduction, 12, "project must preserve gate reduction");
  assert.equal(project.settings.dialogue.eqbass, 6, "project must preserve EQ settings");
  assert.equal(project.settings.dialogue.pan, -100, "project must preserve pan settings");
  assert.equal(project.settings.dialogue.solo, true, "project must preserve solo state");
  assert.equal(project.settings.dialogue.mute, false, "project must preserve mute state");
  assert.equal(project.settings.music.mute, true, "project must preserve mute state for every track");
  assert.ok(project.sources?.dialogue?.sha256, "project should record the source fingerprint");
  assert.equal(project.sources?.dialogue?.decoded, true);
  assert.ok(!Object.hasOwn(project, "audioData"), "project must not silently embed source audio");
  assert.equal(project.videoReference, null, "project without a video must store no video reference");
  assert.deepEqual(project.videoCues, [], "project without video cues should store an empty cue list");
  assert.equal(await page.locator("#referenceVideo").count(), 1, "video reference picker should be available");
  assert.equal(await page.locator("#referenceVideoPlayer").isVisible(), false, "video preview should remain hidden until a video is selected");

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
  assert.equal(await page.locator("#mixPreviewStatus").innerText(), "Previous render — OUTDATED", "project settings changes must invalidate the old preview");
  assert.equal(await page.locator("#mixPreview").getAttribute("class"), "stale", "outdated preview must receive warning styling");


  assert.deepEqual(errors, [], "uncaught page errors: " + errors.join("; "));
  console.log(JSON.stringify({
    status: "PASS",
    aiConnectionValidation: "PASS",
    aiVisualFrontendServiceContract: "PASS",
    aiAudioFrontendServiceContract: "PASS",
    sourceImport: "PASS",
    preflightAndPostDecodeMemoryChecks: "PASS",
    stereoWavRenderAndSerializedPcmQc: "PASS",
    localPreview: "PASS",
    stalePreviewInvalidation: "PASS",
    trackMuteSoloRenderAndProjectPersistence: "PASS",
    projectLoadRoundTrip: "PASS",
    projectJsonDownloadAndFingerprint: "PASS",
    uncaughtPageErrors: errors.length
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
