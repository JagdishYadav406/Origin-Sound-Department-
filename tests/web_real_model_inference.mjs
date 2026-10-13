import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.OSD_BASE_URL || "http://127.0.0.1:4173/web/index.html";
const timeoutMs = 240_000;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const pageErrors = [];
const externalWriteRequests = [];
const externalFailures = [];
const externalHosts = new Set();
const localOrigin = new URL(baseUrl).origin;

page.on("pageerror", error => pageErrors.push(error.message));
page.on("request", request => {
  const url = new URL(request.url());
  if (url.origin !== localOrigin) {
    externalHosts.add(url.host);
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method().toUpperCase())) {
      externalWriteRequests.push({ method: request.method(), host: url.host, path: url.pathname });
    }
  }
});
page.on("response", response => {
  const url = new URL(response.url());
  if (url.origin !== localOrigin && response.status() >= 400) {
    externalFailures.push({ status: response.status(), host: url.host, path: url.pathname });
  }
});

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  assert.match(await page.title(), /Origin Sound Department|OSD/i);

  // Generate a short local WebM in Chromium so this test exercises a real decoded
  // video element without committing copyrighted media or uploading user content.
  const fixture = await page.evaluate(async () => {
    if (!HTMLCanvasElement.prototype.captureStream || typeof MediaRecorder === "undefined") {
      throw new Error("Chromium MediaRecorder/canvas capture is unavailable.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create synthetic video canvas.");
    const stream = canvas.captureStream(12);
    const mimeType = ["video/webm;codecs=vp8", "video/webm"].find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error("No supported WebM MediaRecorder codec.");
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks = [];
    recorder.addEventListener("dataavailable", event => {
      if (event.data?.size) chunks.push(event.data);
    });
    const stopped = new Promise((resolve, reject) => {
      recorder.addEventListener("stop", resolve, { once: true });
      recorder.addEventListener("error", event => reject(event.error || new Error("MediaRecorder failed.")), { once: true });
    });
    const draw = frame => {
      ctx.fillStyle = frame % 2 ? "#2b7a4b" : "#294b91";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#f4d35e";
      ctx.beginPath();
      ctx.arc(60 + (frame * 19) % 200, 88, 35, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f6f7f8";
      ctx.fillRect(18, 18, 42 + (frame % 4) * 9, 14);
      ctx.fillStyle = "#121713";
      ctx.fillRect(205, 122, 70, 28);
    };
    let frame = 0;
    draw(frame);
    const timer = setInterval(() => draw(++frame), 80);
    recorder.start(100);
    await new Promise(resolve => setTimeout(resolve, 1800));
    clearInterval(timer);
    recorder.stop();
    await stopped;
    for (const track of stream.getTracks()) track.stop();
    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size < 1000) throw new Error("Synthetic WebM fixture is unexpectedly small.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { base64: btoa(binary), mimeType, size: blob.size };
  });

  await page.locator("#referenceVideo").setInputFiles({
    name: "osd-real-model-inference-fixture.webm",
    mimeType: fixture.mimeType,
    lastModified: 1700000000000,
    buffer: Buffer.from(fixture.base64, "base64")
  });
  await page.waitForFunction(() => {
    const player = document.querySelector("#referenceVideoPlayer");
    return player && player.readyState >= 1 && Number.isFinite(player.duration) &&
      player.duration > 0 && player.videoWidth > 0 && player.videoHeight > 0;
  }, null, { timeout: 15_000 });

  const playerState = await page.locator("#referenceVideoPlayer").evaluate(video => ({
    duration: video.duration, width: video.videoWidth, height: video.videoHeight
  }));
  assert.ok(playerState.duration > 0 && playerState.width > 0 && playerState.height > 0,
    "synthetic source must decode to real video metadata");

  await page.locator("#runLocalVisualModel").click();
  await page.waitForFunction(() => {
    const status = document.querySelector("#aiAnalysisStatus")?.textContent || "";
    return status.includes("Free MobileNet analysis complete:") ||
      status.includes("Free visual AI failed:");
  }, null, { timeout: timeoutMs });

  const status = await page.locator("#aiAnalysisStatus").innerText();
  const log = await page.locator("#log").innerText();
  if (!status.includes("Free MobileNet analysis complete:") ||
      !log.includes("LOCAL_MOBILENET_ANALYSIS_COMPLETE")) {
    throw new Error("REAL_MODEL_INFERENCE_FAILED: " + JSON.stringify({
      status,
      recentLog: log.slice(-5000),
      externalHosts: [...externalHosts],
      externalFailures
    }));
  }

  const results = await page.locator("#aiAnalysisResults").innerText();
  assert.match(results, /MobileNet visual classification/i,
    "UI must render real classifier results rather than only a mock response");
  assert.match(results, /Top ImageNet label:/i,
    "results must identify the model's returned top label");
  assert.deepEqual(externalWriteRequests, [],
    "local model inference must not send external POST/PUT/PATCH/DELETE requests");
  assert.deepEqual(pageErrors, [], "uncaught browser errors: " + pageErrors.join("; "));

  console.log(JSON.stringify({
    status: "PASS",
    check: "real browser-local MobileNet inference",
    syntheticVideo: { bytes: fixture.size, ...playerState },
    modelInference: "completed",
    mediaUpload: "no external write requests observed",
    externalHosts: [...externalHosts].sort(),
    externalHttpFailures: externalFailures
  }, null, 2));
} finally {
  await context.close();
  await browser.close();
}
