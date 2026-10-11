import http from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT || 8787);
const MODEL = process.env.OSD_AI_MODEL || "gpt-4.1-mini";
const API_KEY = process.env.OPENAI_API_KEY || "";
const SERVICE_TOKEN = process.env.OSD_SERVICE_TOKEN || "";
const ALLOWED_ORIGINS = new Set(
  (process.env.OSD_ALLOWED_ORIGINS || "http://localhost:4173,http://127.0.0.1:4173")
    .split(",").map((s) => s.trim()).filter(Boolean)
);
const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_FRAME_DATA_URL_CHARS = 1_500_000;
const MAX_FRAMES = 12;
const MAX_DURATION_SECONDS = 600;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 10;
const rateBuckets = new Map();
let activeAnalyses = 0;
const MAX_CONCURRENT_ANALYSES = 2;

const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "scenes", "cues", "limitations"],
  properties: {
    summary: { type: "string" },
    scenes: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["start_seconds", "end_seconds", "description", "visible_evidence", "mood", "energy", "confidence"],
        properties: {
          start_seconds: { type: "number" }, end_seconds: { type: "number" },
          description: { type: "string" }, visible_evidence: { type: "string" },
          mood: { type: "string" }, energy: { type: "string" },
          confidence: { type: "number" }
        }
      }
    },
    cues: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["category", "start_seconds", "end_seconds", "description", "rationale", "confidence", "search_terms"],
        properties: {
          category: { type: "string", enum: ["music", "sfx", "ambience", "dialogue", "transition"] },
          start_seconds: { type: "number" }, end_seconds: { type: "number" },
          description: { type: "string" }, rationale: { type: "string" },
          confidence: { type: "number" },
          search_terms: { type: "array", items: { type: "string" } }
        }
      }
    },
    limitations: { type: "array", items: { type: "string" } }
  }
};

function json(res, status, value, extraHeaders = {}) {
  const data = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders
  });
  res.end(data);
}

function corsHeaders(origin) {
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "Content-Type,Authorization",
    "vary": "Origin"
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let rejected = false;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        if (!rejected) {
          rejected = true;
          reject(Object.assign(new Error("Request body exceeds the 10 MiB limit."), { status: 413 }));
        }
        return;
      }
      if (!rejected) chunks.push(chunk);
    });
    req.on("end", () => {
      if (rejected) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

function validateRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw Object.assign(new Error("Request must be a JSON object."), { status: 400 });
  const duration = body.durationSeconds;
  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0 || duration > MAX_DURATION_SECONDS) {
    throw Object.assign(new Error("durationSeconds must be greater than 0 and no more than 600."), { status: 400 });
  }
  if (!Array.isArray(body.frames) || body.frames.length < 1 || body.frames.length > MAX_FRAMES) {
    throw Object.assign(new Error("Provide 1–12 sampled video frames."), { status: 400 });
  }
  const frames = body.frames.map((frame, index) => {
    if (!frame || typeof frame !== "object") throw Object.assign(new Error(`Frame ${index + 1} is invalid.`), { status: 400 });
    const t = frame.timestampSeconds;
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > duration) {
      throw Object.assign(new Error(`Frame ${index + 1} has a timestamp outside the clip.`), { status: 400 });
    }
    const dataUrl = frame.imageDataUrl;
    if (typeof dataUrl !== "string" || dataUrl.length > MAX_FRAME_DATA_URL_CHARS) {
      throw Object.assign(new Error(`Frame ${index + 1} image is missing or too large.`), { status: 413 });
    }
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw Object.assign(new Error(`Frame ${index + 1} must be a base64 JPEG, PNG, or WebP data URL.`), { status: 400 });
    return { timestampSeconds: t, imageDataUrl: dataUrl, mime: match[1] };
  }).sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  return { durationSeconds: duration, frames, intent: typeof body.intent === "string" ? body.intent.slice(0, 1200) : "" };
}

function validateModelResult(result, duration) {
  if (!result || typeof result !== "object" || !Array.isArray(result.scenes) || !Array.isArray(result.cues) || !Array.isArray(result.limitations)) {
    throw new Error("Model result did not match the OSD result contract.");
  }
  for (const [kind, rows] of [["scene", result.scenes], ["cue", result.cues]]) {
    if (rows.length > 120) throw new Error(`Model returned too many ${kind} items.`);
    for (const row of rows) {
      const start = row.start_seconds, end = row.end_seconds, confidence = row.confidence;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > duration + 0.05) {
        throw new Error(`Model returned an out-of-range ${kind} timestamp; results were rejected.`);
      }
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error(`Model returned invalid ${kind} confidence.`);
    }
  }
  for (const cue of result.cues) {
    if (!["music", "sfx", "ambience", "dialogue", "transition"].includes(cue.category) ||
        typeof cue.description !== "string" || typeof cue.rationale !== "string" ||
        !Array.isArray(cue.search_terms) || cue.search_terms.some((term) => typeof term !== "string")) {
      throw new Error("Model returned an invalid sound cue; results were rejected.");
    }
  }
  return result;
}

function extractOutputText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  for (const item of response?.output || []) {
    if (item.type !== "message") continue;
    for (const part of item.content || []) if (part.type === "output_text" && typeof part.text === "string") return part.text;
  }
  throw new Error("AI provider returned no structured text output.");
}

async function callVisionModel(request, fetchImpl = fetch) {
  if (!API_KEY) throw Object.assign(new Error("AI provider is not configured: OPENAI_API_KEY is missing on the service."), { status: 503 });
  const content = [{
    type: "input_text",
    text: [
      "You are OSD Sound Director, a careful assistant to a human sound editor.",
      "Analyze only what the sampled video frames visibly support. The frames are sparse samples, not continuous footage; do not claim precise cuts between unsampled frames.",
      "Propose a time-coded soundtrack design: music direction, sound effects, ambience, dialogue-space/ducking notes, and transitions. Describe sound ideas, not guaranteed asset availability.",
      "Do not invent library asset IDs, exact dialogue, off-screen events, or facts not supported by the images. Mark uncertainty through low confidence and limitations.",
      "Every scene/cue timestamp must lie within the supplied clip duration. Use short descriptions and practical search terms. Keep dialogue audible; suggest rather than automatically apply all changes.",
      `Clip duration: ${request.durationSeconds.toFixed(3)} seconds. Frame timestamps (seconds): ${request.frames.map((f) => f.timestampSeconds.toFixed(3)).join(", ")}.`,
      request.intent ? `Editor intent: ${request.intent}` : "Editor intent: propose a balanced, cinematic soundtrack appropriate to the visible material."
    ].join("\n")
  }];
  for (const frame of request.frames) {
    content.push({ type: "input_text", text: `Frame timestamp: ${frame.timestampSeconds.toFixed(3)} seconds.` });
    content.push({ type: "input_image", image_url: frame.imageDataUrl, detail: "low" });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  let response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: { "authorization": `Bearer ${API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, store: false, max_output_tokens: 5000,
        input: [{ role: "user", content }],
        text: { format: { type: "json_schema", name: "osd_sound_plan", strict: true, schema: outputSchema } }
      })
    });
  } catch (error) {
    if (error?.name === "AbortError") throw Object.assign(new Error("AI analysis timed out after 45 seconds."), { status: 504 });
    throw Object.assign(new Error("AI provider could not be reached."), { status: 502 });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    const status = response.status === 429 ? 429 : response.status >= 500 ? 502 : 502;
    throw Object.assign(new Error(response.status === 429 ? "AI provider rate limit reached; retry later." : "AI provider rejected or failed the analysis request."), { status });
  }
  const payload = await response.json();
  const text = extractOutputText(payload);
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw Object.assign(new Error("AI provider returned invalid JSON; no result was accepted."), { status: 502 }); }
  try { return validateModelResult(parsed, request.durationSeconds); }
  catch (error) { throw Object.assign(new Error(error.message || "AI result failed validation."), { status: 502 }); }
}

const AUDIO_MODEL = process.env.OSD_AUDIO_MODEL || "gpt-audio-1.5";
const MAX_AUDIO_DATA_CHARS = 7_000_000;
const MAX_AUDIO_DURATION_SECONDS = 90;

function validateAudioRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw Object.assign(new Error("Request must be a JSON object."), { status: 400 });
  if (typeof body.durationSeconds !== "number" || !Number.isFinite(body.durationSeconds) || body.durationSeconds <= 0 || body.durationSeconds > MAX_AUDIO_DURATION_SECONDS) {
    throw Object.assign(new Error("Audio duration must be greater than 0 and no more than 90 seconds."), { status: 400 });
  }
  const dataUrl = body.audioDataUrl;
  if (typeof dataUrl !== "string" || dataUrl.length > MAX_AUDIO_DATA_CHARS) throw Object.assign(new Error("Audio is missing or exceeds the 7 MB encoded audio limit."), { status: 413 });
  const match = /^data:audio\/(wav|mpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw Object.assign(new Error("Provide a base64 WAV or MP3 audio data URL."), { status: 400 });
  return {
    durationSeconds: body.durationSeconds,
    format: match[1] === "mpeg" ? "mp3" : "wav",
    audioBase64: match[2],
    intent: typeof body.intent === "string" ? body.intent.slice(0, 1200) : ""
  };
}

function extractChatText(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const textPart = content.find((part) => part.type === "text" && typeof part.text === "string");
    if (textPart) return textPart.text;
  }
  throw new Error("Audio model returned no text analysis.");
}

async function callAudioModel(request, fetchImpl = fetch) {
  if (!API_KEY) throw Object.assign(new Error("AI provider is not configured: OPENAI_API_KEY is missing on the service."), { status: 503 });
  const prompt = [
    "You are OSD Sound Director, an audio-aware assistant to a human sound editor.",
    "Analyze the supplied audio only. Report audible evidence, not visual events. Do not hallucinate exact words, instruments, source identities, or timestamps when uncertain.",
    "Return ONLY a JSON object matching this structure: {summary:string,scenes:[{start_seconds:number,end_seconds:number,description:string,visible_evidence:string,mood:string,energy:string,confidence:number}],cues:[{category:'music'|'sfx'|'ambience'|'dialogue'|'transition',start_seconds:number,end_seconds:number,description:string,rationale:string,confidence:number,search_terms:string[]}],limitations:string[]}.",
    "In scenes, the field visible_evidence is retained for API compatibility; put AUDIBLE evidence there, never visual claims.",
    "Time-code only broad regions that can be reasonably inferred from the audio. All timestamps must be within the clip duration. If a cue cannot be localized, use a broad interval and lower confidence.",
    "Assess audible dialogue/speech presence and intelligibility only when supported; distinguish speech presence from transcription. Describe music, ambience, discrete effects, clipping/noise risks, masking, dynamic contrast, and useful sound-design opportunities.",
    "Recommend soundtrack actions such as preserving dialogue, reducing masking music, or adding a type of sound. Do not claim a sound-library asset is available. Keep the original performance; avoid automatic aggressive cleanup. No audio processing is applied.",
    `Clip duration: ${request.durationSeconds.toFixed(3)} seconds.`,
    request.intent ? `Editor intent: ${request.intent}` : "Editor intent: propose a balanced, natural, cinematic sound plan while protecting dialogue."
  ].join("\n");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  let response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST", signal: controller.signal,
      headers: { "authorization": `Bearer ${API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: AUDIO_MODEL, store: false, modalities: ["text"],
        messages: [{ role: "user", content: [
          { type: "text", text: prompt },
          { type: "input_audio", input_audio: { data: request.audioBase64, format: request.format } }
        ] }]
      })
    });
  } catch (error) {
    if (error?.name === "AbortError") throw Object.assign(new Error("Audio AI analysis timed out after 60 seconds."), { status: 504 });
    throw Object.assign(new Error("Audio AI provider could not be reached."), { status: 502 });
  } finally { clearTimeout(timer); }
  if (!response.ok) {
    const message = response.status === 429 ? "AI provider rate limit reached; retry later." : "Audio AI provider rejected or failed the request.";
    throw Object.assign(new Error(message), { status: response.status === 429 ? 429 : 502 });
  }
  const payload = await response.json();
  let parsed;
  try { parsed = JSON.parse(extractChatText(payload).replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "")); }
  catch { throw Object.assign(new Error("Audio model returned invalid JSON; no result was accepted."), { status: 502 }); }
  try { return validateModelResult(parsed, request.durationSeconds); }
  catch (error) { throw Object.assign(new Error(error.message || "Audio analysis failed validation."), { status: 502 }); }
}

export function createServer({ fetchImpl = fetch } = {}) {
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin || "";
    const cors = corsHeaders(origin);
    if (req.method === "OPTIONS") {
      if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "Origin is not allowed." });
      res.writeHead(204, cors); return res.end();
    }
    const url = new URL(req.url || "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/v1/health") {
      return json(res, 200, { status: "ok", configured: Boolean(API_KEY && SERVICE_TOKEN), provider: "openai", model: MODEL, audioModel: AUDIO_MODEL, limits: { maxDurationSeconds: MAX_DURATION_SECONDS, maxAudioDurationSeconds: MAX_AUDIO_DURATION_SECONDS, maxFrames: MAX_FRAMES, maxRequestBytes: MAX_BODY_BYTES } }, cors);
    }
    if (!["/v1/analyze", "/v1/analyze-audio"].includes(url.pathname) || req.method !== "POST") return json(res, 404, { error: "Not found." }, cors);
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { error: "Origin is not allowed." });
    if (!SERVICE_TOKEN) return json(res, 503, { error: "AI service access is not configured. Set OSD_SERVICE_TOKEN on the server." }, cors);
    if (req.headers.authorization !== `Bearer ${SERVICE_TOKEN}`) return json(res, 401, { error: "Service authentication failed." }, cors);
    const ip = String(req.socket.remoteAddress || "unknown");
    const now = Date.now();
    const bucket = rateBuckets.get(ip) || { start: now, count: 0 };
    if (now - bucket.start >= RATE_WINDOW_MS) { bucket.start = now; bucket.count = 0; }
    bucket.count++; rateBuckets.set(ip, bucket);
    if (bucket.count > RATE_MAX) return json(res, 429, { error: "OSD analysis rate limit reached; wait before retrying." }, cors);
    if (activeAnalyses >= MAX_CONCURRENT_ANALYSES) return json(res, 429, { error: "OSD is at its analysis concurrency limit; retry shortly." }, cors);
    activeAnalyses++;
    const requestId = randomUUID();
    try {
      const raw = await readJson(req);
      if (url.pathname === "/v1/analyze-audio") {
        const request = validateAudioRequest(raw);
        const analysis = await callAudioModel(request, fetchImpl);
        return json(res, 200, {
          requestId, status: "completed", model: AUDIO_MODEL, method: "audio-aware-model",
          durationSeconds: request.durationSeconds, coverage: "audio input analyzed; timestamps are model estimates and must be reviewed",
          analysis
        }, cors);
      }
      const request = validateRequest(raw);
      const result = await callVisionModel(request, fetchImpl);
      return json(res, 200, {
        requestId, status: "completed", model: MODEL, method: "sampled-frame-vision",
        durationSeconds: request.durationSeconds,
        sampledFrameTimesSeconds: request.frames.map((f) => f.timestampSeconds),
        coverage: "sparse sampled frames only; audio was not analyzed",
        analysis: result
      }, cors);
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      return json(res, status, { requestId, status: "failed", error: error?.message || "Unexpected analysis failure." }, cors);
    } finally {
      activeAnalyses--;
    }
  });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const server = createServer();
  server.listen(PORT, "0.0.0.0", () => {
    process.stdout.write(`OSD AI Sound Director service listening on port ${PORT}; model=${MODEL}; configured=${Boolean(API_KEY && SERVICE_TOKEN)}\n`);
  });
}
