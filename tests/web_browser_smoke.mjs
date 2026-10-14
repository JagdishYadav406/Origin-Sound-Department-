import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.OSD_BASE_URL || "http://127.0.0.1:4173/web/index.html";
const browser = await chromium.launch({ headless: true });
const errors = [];
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
// The AI request-contract test uses a deterministic synthetic video surface. This isolates
// UI/payload wiring from codecs installed on the CI runner; real codec/device playback is
// deliberately not claimed by this test.
await page.addInitScript(() => {
  const mediaProto = HTMLMediaElement.prototype;
  const nativeSrc = Object.getOwnPropertyDescriptor(mediaProto, "src");
  const fakeSources = new WeakMap();
  const fakeTimes = new WeakMap();
  Object.defineProperty(mediaProto, "src", {
    configurable: true,
    enumerable: nativeSrc.enumerable,
    get() { return this instanceof HTMLVideoElement ? (fakeSources.get(this) || "") : nativeSrc.get.call(this); },
    set(value) {
      if (!(this instanceof HTMLVideoElement)) { nativeSrc.set.call(this, value); return; }
      fakeSources.set(this, String(value));
      queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
    }
  });
  for (const [name, getter] of Object.entries({
    duration: () => 1.4, videoWidth: () => 160, videoHeight: () => 90,
    readyState: () => HTMLMediaElement.HAVE_CURRENT_DATA, paused: () => true,
    currentTime: function () { return fakeTimes.get(this) || 0; }
  })) {
    Object.defineProperty(HTMLVideoElement.prototype, name, {
      configurable: true,
      get: name === "currentTime" ? getter : getter
    });
  }
  Object.defineProperty(HTMLVideoElement.prototype, "currentTime", {
    configurable: true,
    get() { return fakeTimes.get(this) || 0; },
    set(value) {
      fakeTimes.set(this, Number(value) || 0);
      queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
    }
  });
  HTMLVideoElement.prototype.load = function () {};
  HTMLVideoElement.prototype.pause = function () {};
  HTMLVideoElement.prototype.play = function () { return Promise.resolve(); };
  const drawImage = CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage = function (source, ...args) {
    if (source instanceof HTMLVideoElement) return;
    return drawImage.call(this, source, ...args);
  };
});
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
          scenes: [{ ...mockAiAnalysis.scenes[0], start_seconds: 0, end_seconds: Math.min(0.4, audioBody.durationSeconds), description: "Speech over a continuous tonal bed.", visible_evidence: "AUDIBLE evidence: speech and a tonal bed are present." }],
          cues: [{ ...mockAiAnalysis.cues[0], start_seconds: 0, end_seconds: Math.min(0.4, audioBody.durationSeconds), description: "Keep background music below the narration.", rationale: "Mock audio response verifies the audio-aware UI path." }],
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

  const videoBase64 = Buffer.from("synthetic-video-surface").toString("base64");
  await page.locator("#referenceVideo").setInputFiles({
    name: "osd-ai-contract-smoke.webm",
    mimeType: "video/webm",
    buffer: Buffer.from(videoBase64, "base64")
  });
  await page.waitForFunction(() => {
    const state = document.querySelector("#videoReferenceState")?.textContent || "";
    return state.includes("Video metadata read by this browser") || state.includes("could not read the video metadata");
  }, null, { timeout: 15000 });
  const videoReadiness = await page.evaluate(() => ({
    duration: document.querySelector("#referenceVideoPlayer")?.duration,
    width: document.querySelector("#referenceVideoPlayer")?.videoWidth,
    height: document.querySelector("#referenceVideoPlayer")?.videoHeight,
    state: document.querySelector("#videoReferenceState")?.textContent
  }));
  assert.ok(Number.isFinite(videoReadiness.duration) && videoReadiness.duration > 0 && videoReadiness.width > 0 && videoReadiness.height > 0,
    "generated WebM fixture must decode before AI integration test: " + JSON.stringify(videoReadiness));
    await page.locator("#aiServiceUrl").fill("https://mock-osd-ai.example");
  await page.locator("#aiServiceToken").fill("mock-service-token");
  await page.locator("#testAIConnection").click();
  await page.waitForFunction(() => (document.querySelector("#aiConnectionStatus")?.textContent || "").includes("Service reachable and configured"), null, { timeout: 5000 });
  await page.locator("#aiUploadConsent").check();
  await page.waitForFunction(() => {
    const button = document.querySelector("#analyzeVideoAI");
    return button && !button.disabled;
  }, null, { timeout: 5000 });
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
  assert.equal(await page.locator("#buildAutonomousEdit").isEnabled(), true, "autonomous edit draft should enable only after video analysis completes");
  const gainBeforeAutonomousDraft = await page.locator("#gain-dialogue").inputValue();
  await page.locator("#buildAutonomousEdit").click();
  await page.waitForFunction(() => (document.querySelector("#autonomousEditStatus")?.textContent || "").includes("Draft built"), null, { timeout: 5000 });
  assert.match(await page.locator("#autonomousEditSummary").innerText(), /1 scene observations/);
  assert.match(await page.locator("#autonomousEditSummary").innerText(), /1 sound cues/);
  assert.equal(await page.locator("#exportAutonomousEdit").isEnabled(), true, "valid edit package should be exportable");
  assert.equal(await page.locator("#applyAutonomousEdit").isEnabled(), true, "valid sound cue plan should be stageable");
  assert.equal(await page.locator("#gain-dialogue").inputValue(), gainBeforeAutonomousDraft, "building a draft must not change mix settings");
  assert.match(await page.locator("#autonomousEditSummary").innerText(), /Full OSD tool coverage and readiness/);
  assert.match(await page.locator("#autonomousEditSummary").innerText(), /dialogue import/);
  assert.match(await page.locator("#autonomousEditSummary").innerText(), /project JSON save\/load/);
  assert.equal(await page.locator("#prepareAutonomousWorkspaces").isEnabled(), true, "full-tool safe preparation should be enabled for a current draft");
  await page.locator("#prepareAutonomousWorkspaces").click();
  await page.waitForFunction(() => (document.querySelector("#autonomousEditStatus")?.textContent || "").includes("Safe preparation finished"), null, { timeout: 5000 });
  assert.match(await page.locator("#videoCueList").innerText(), /restrained musical bed/);
  assert.equal(await page.locator("#pictureTimelineList .cue-row").count(), 2, "scene boundaries should create two retained picture intervals in the synthetic fixture");
  assert.match(await page.locator("#autonomousEditStatus").innerText(), /no mix settings or source media were changed/);
  assert.equal(await page.locator("#gain-dialogue").inputValue(), gainBeforeAutonomousDraft, "workspace preparation must not change mix settings");
  // A mix-control change must invalidate the prepared draft; the runner may rebuild,
  // but must not continue with the old approval state or stale tool snapshot.
  const changedDialogueGain = String(Math.min(12, Number(gainBeforeAutonomousDraft) + 1));
  await page.locator("#gain-dialogue").fill(changedDialogueGain);
  assert.equal(await page.locator("#exportAutonomousEdit").isDisabled(), true,
    "changing a mix control must make the previous autonomous draft non-exportable");
  assert.equal(await page.locator("#prepareAutonomousWorkspaces").isDisabled(), true,
    "changing a mix control must block staging from the stale draft");
  await page.locator("#continueAutonomousWorkflow").click();
  assert.match(await page.locator("#autonomousWorkflowStatus").innerText(), /Built a fresh draft from current source and evidence/,
    "runner should rebuild from current state rather than use a stale draft");
  assert.equal(await page.locator("#autonomousTrackReviewConfirmed").isChecked(), false,
    "rebuilding a draft must reset prior review approvals");
  await page.locator("#prepareAutonomousWorkspaces").click();
  await page.waitForFunction(() => (document.querySelector("#autonomousEditStatus")?.textContent || "").includes("Safe preparation finished"), null, { timeout: 5000 });
  await page.locator("#continueAutonomousWorkflow").click();
  assert.match(await page.locator("#autonomousWorkflowStatus").innerText(), /Review checkpoint: inspect each loaded source preview/);
  assert.equal(await page.locator("#render").isDisabled(), true, "autonomous runner must not render before the track-review checkpoint");
  while (await page.locator('#pictureTimelineList button[aria-label^="Remove picture interval"]').count()) {
    await page.locator('#pictureTimelineList button[aria-label^="Remove picture interval"]').first().click();
  }
  assert.equal(await page.locator("#pictureTimelineList .cue-row").count(), 0, "review test must remove staged intervals before project round-trip assertions");
  await page.locator("#clearVideoCues").click(); // Keep later project round-trip assertions isolated from this feature test.

  // With no current analysis, the autonomous runner should choose the free local
  // visual heuristic rather than require a paid model or bypass connected-AI consent.
  await page.locator("#clearAIResults").click();
  await page.locator("#continueAutonomousWorkflow").click();
  assert.match(await page.locator("#autonomousWorkflowStatus").innerText(), /Started the free local video-analysis fallback/);
  await page.waitForFunction(() => (document.querySelector("#aiAnalysisStatus")?.textContent || "").includes("Free local video scan complete"), null, { timeout: 15000 });
  assert.match(await page.locator("#aiAnalysisStatus").innerText(), /no media uploaded/);

  // Verify the separate, explicitly consented audio-aware request path as well.
  await page.locator("#aiAudioFile").setInputFiles({
    name: "osd-ai-audio-contract-smoke.wav",
    mimeType: "audio/wav",
    buffer: makePcmWav({ seconds: 0.5, frequency: 220, amplitude: 0.04 })
  });
  // Explicitly confirm alignment and let the runner choose the free local audio
  // measurement path before testing the separate consented connected-AI request.
  await page.locator("#aiTimelineAligned").check();
  await page.locator("#continueAutonomousWorkflow").click();
  assert.match(await page.locator("#autonomousWorkflowStatus").innerText(), /Started free local audio analysis for the selected audio file/);
  await page.waitForFunction(() => (document.querySelector("#audioAIStatus")?.textContent || "").includes("Free local audio measurement complete"), null, { timeout: 15000 });
  assert.match(await page.locator("#audioAIStatus").innerText(), /No upload, account, AI model, or credits used/);
  await page.locator("#aiTimelineAligned").uncheck();
  await page.locator("#aiAudioConsent").check();
  await page.locator("#analyzeAudioAI").click();
  await page.waitForFunction(() => (document.querySelector("#audioAIStatus")?.textContent || "").includes("Audio analysis complete"), null, { timeout: 15000 });
  assert.match(await page.locator("#aiAnalysisResults").innerText(), /Mock audio integration: speech/);
  assert.match(await page.locator("#aiAnalysisResults").innerText(), /Keep background music below the narration/);
  assert.equal(await page.locator("#buildAutonomousEdit").isDisabled(), true, "audio-only proposals must not be aligned to the video by assumption");
  await page.locator("#aiTimelineAligned").check();
  await page.locator("#continueAutonomousWorkflow").click();
  assert.match(await page.locator("#autonomousWorkflowStatus").innerText(), /Combined the current visual and audio analyses using the explicitly confirmed shared 00:00 start/);
  assert.match(await page.locator("#aiAnalysisResults").innerText(), /Combined plan from separate visual-frame and audio-aware analyses/);
  assert.equal(await page.locator("#buildAutonomousEdit").isEnabled(), true, "confirmed combined analysis should enable autonomous draft creation");
  await page.locator("#buildAutonomousEdit").click();
  await page.waitForFunction(() => (document.querySelector("#autonomousEditStatus")?.textContent || "").includes("Draft built"), null, { timeout: 5000 });
  assert.match(await page.locator("#autonomousEditSummary").innerText(), /Keep background music below the narration/);
  await page.locator("#aiTimelineAligned").uncheck();
  assert.equal(await page.locator("#exportAutonomousEdit").isDisabled(), true, "withdrawing alignment must invalidate an audio-based draft");

  // Exercise the free, browser-local classifier button end-to-end with a deterministic
  // mock Transformers module. This tests UI wiring, decoded-audio preprocessing, result
  // rendering, and failure-free cleanup without downloading model weights in CI.
    await page.locator("#aiAudioFile").setInputFiles({
    name: "osd-local-ai-smoke.wav",
    mimeType: "audio/wav",
    buffer: makePcmWav()
  });
  await page.waitForFunction(() => {
    const el = document.querySelector("#runLocalAudioModel");
    return el && !el.disabled;
  });
  await page.route("**/@huggingface/transformers@3.8.1*", async route => {
    await route.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      body: "export function pipeline(){return async function(){return [{label:'Speech',score:0.91},{label:'Music',score:0.42}]}}"
    });
  });
  await page.locator("#runLocalAudioModel").click();
  await page.waitForFunction(() => (document.querySelector("#audioAIStatus")?.textContent || "").includes("Free local audio model complete"), null, { timeout: 15000 });
  assert.match(await page.locator("#aiAnalysisResults").innerText(), /Speech/);
  assert.match(await page.locator("#aiAnalysisResults").innerText(), /local-audioset|AudioSet classifier/i);
  assert.match(await page.locator("#audioAIStatus").innerText(), /No upload or paid API/i);
  await page.unroute("**/@huggingface/transformers@3.8.1*");

  // Exercise the free browser-local visual classifier with deterministic runtime/model
  // shims. This verifies video sampling, model API wiring, result rendering, and cleanup
  // without downloading large TensorFlow.js/model assets in CI. It does not claim real inference.
  await page.route("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js", async route => {
    await route.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      body: "window.tf={ready:async()=>{},setBackend:async()=>{}};"
    });
  });
  await page.route("https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1", async route => {
    await route.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      body: "window.mobilenet={load:async()=>({classify:async()=>[{className:'test frame object',probability:0.88},{className:'test background',probability:0.45}]})};"
    });
  });
  await page.locator("#runLocalVisualModel").click();
  await page.waitForFunction(() => (document.querySelector("#aiAnalysisStatus")?.textContent || "").includes("Free MobileNet analysis complete"), null, { timeout: 15000 });
  assert.match(await page.locator("#aiAnalysisResults").innerText(), /test frame object/);
  assert.match(await page.locator("#aiAnalysisResults").innerText(), /pretrained image classifier/i);
  assert.match(await page.locator("#aiAnalysisStatus").innerText(), /No media uploaded/i);
  assert.match(await page.locator("#log").innerText(), /LOCAL_MOBILENET_ANALYSIS_COMPLETE.*upload=false paid_api=false/);
  await page.unroute("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js");
  await page.unroute("https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1");

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
  assert.equal(await page.locator("#analyzeAutonomousTracks").isEnabled(), true, "track evidence should be available once a decoded source is loaded");
  const dialogueGainBeforeTrackScan = await page.locator("#gain-dialogue").inputValue();
  await page.locator("#analyzeAutonomousTracks").click();
  await page.waitForFunction(() => (document.querySelector("#autonomousTrackEvidenceStatus")?.textContent || "").includes("Signal evidence complete"), null, { timeout: 10000 });
  assert.match(await page.locator("#autonomousTrackEvidenceResults").innerText(), /DIALOGUE · osd-smoke-dialogue\.wav/);
  assert.match(await page.locator("#autonomousTrackEvidenceResults").innerText(), /Sample peak:/);
  assert.match(await page.locator("#autonomousTrackEvidenceResults").innerText(), /true peak/);
  assert.equal(await page.locator("#gain-dialogue").inputValue(), dialogueGainBeforeTrackScan, "signal analysis must not alter processing settings");
  assert.match(await page.locator("#log").innerText(), /AUTONOMOUS_TRACK_EVIDENCE_COMPLETE.*source_upload=false processing_settings_changed=false/);

  let unexpectedRenderDownloads = 0;
  const countUnexpectedRenderDownload = () => { unexpectedRenderDownloads += 1; };
  page.on("download", countUnexpectedRenderDownload);
  await page.locator("#render").click();
  await page.waitForFunction(() => {
    const message = document.querySelector("#message")?.textContent || "";
    return message.startsWith("Stereo WAV created") || message.startsWith("Render stopped") || message.startsWith("Mix did not complete");
  }, null, { timeout: 20000 });
  await page.waitForTimeout(250);
  page.off("download", countUnexpectedRenderDownload);
  assert.equal(unexpectedRenderDownloads, 0, "render should prepare a preview without forcing an automatic download");
  assert.equal(await page.locator("#downloadMix").isDisabled(), false, "explicit WAV download should be enabled after successful render");

  const renderMessage = await page.locator("#message").innerText();
  assert.match(renderMessage, /^Stereo WAV created\b/, "render did not succeed: " + renderMessage);
  assert.equal(await page.locator("#mixPreview").isVisible(), true);
  assert.match(await page.locator("#mixPreviewStatus").innerText(), /CURRENT$/, "successful render should be marked current");
  assert.equal(await page.locator("#exportVideoMix").isDisabled(), true, "video export must remain disabled when video and mix durations differ");
  await page.waitForFunction(() => (document.querySelector("#videoMixExportStatus")?.textContent || "").includes("differ by"), null, { timeout: 5000 });
  assert.match(await page.locator("#videoMixExportStatus").innerText(), /Blocked: video and mix differ/, "duration mismatch must be explained, not silently trimmed or padded");
  await page.evaluate(() => {
    Object.defineProperty(HTMLVideoElement.prototype, "duration", { configurable: true, get: () => 601 });
    document.querySelector("#referenceVideoPlayer").dispatchEvent(new Event("loadedmetadata"));
  });
  await page.waitForFunction(() => (document.querySelector("#videoMixExportStatus")?.textContent || "").includes("limited to 10 minutes"), null, { timeout: 5000 });
  assert.equal(await page.locator("#exportVideoMix").isDisabled(), true, "video export must reject durations over the 10-minute resource guard");
  await page.evaluate(() => {
    Object.defineProperty(HTMLVideoElement.prototype, "duration", { configurable: true, get: () => 1.4 });
    document.querySelector("#referenceVideoPlayer").dispatchEvent(new Event("loadedmetadata"));
  });
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
  assert.equal(project.projectVersion, 13);
  assert.equal(project.timelineClips?.length, 0, "project should record an empty clip manifest when no extra clips are loaded");
  assert.deepEqual(project.pictureTimeline.segments, [], "project should preserve an empty picture timeline when no intervals are selected");
  assert.equal(project.pictureTimeline.source?.name, project.videoReference?.name, "picture timeline source should match the saved video reference");
  assert.equal(project.pictureTimeline.source?.size, project.videoReference?.size, "picture timeline should preserve source size metadata");
  assert.equal(project.pictureTimeline.source?.lastModified, project.videoReference?.lastModified, "picture timeline should preserve source modification metadata");
  assert.equal(project.pictureTimeline.source?.durationSeconds, project.videoReference?.durationSeconds, "picture timeline should preserve source duration metadata");
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
  assert.equal(project.videoReference?.name, "osd-ai-contract-smoke.webm", "project should preserve the selected video reference metadata");
  assert.equal(project.videoReference?.mime, "video/webm", "project should preserve the selected video MIME type");
  assert.equal(project.videoReference?.durationSeconds, 1.4, "project should preserve the decoded video duration");
  assert.equal(project.videoReference?.width, 160, "project should preserve decoded video width");
  assert.equal(project.videoReference?.height, 90, "project should preserve decoded video height");
  assert.deepEqual(project.videoCues, [], "project without video cues should store an empty cue list");
  assert.equal(await page.locator("#referenceVideo").count(), 1, "video reference picker should be available");
  assert.equal(await page.locator("#referenceVideoPlayer").isVisible(), true, "selected video preview should remain available after project save");

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


  // Mobile-sized layout smoke check (not a substitute for testing on the physical phone).
  await page.setViewportSize({ width: 360, height: 800 });
  await page.waitForTimeout(100);
  const mobileLayout = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    renderVisible: !!document.querySelector("#render") && document.querySelector("#render").getBoundingClientRect().width > 0,
    downloadVisible: !!document.querySelector("#downloadMix") && document.querySelector("#downloadMix").getBoundingClientRect().width > 0,
    sourceTrackCount: document.querySelectorAll("[data-track], .track").length
  }));
  assert.ok(mobileLayout.renderVisible, "render control should remain visible at a 360px mobile viewport");
  assert.ok(mobileLayout.downloadVisible, "explicit WAV download control should remain visible at a 360px mobile viewport");
  assert.ok(mobileLayout.documentWidth <= mobileLayout.viewportWidth + 2, `mobile layout should not create page-level horizontal overflow: ${JSON.stringify(mobileLayout)}`);

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
