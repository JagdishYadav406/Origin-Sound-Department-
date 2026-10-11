import test from "node:test";
import assert from "node:assert/strict";

process.env.OPENAI_API_KEY = "test-provider-key-not-real";
process.env.OSD_SERVICE_TOKEN = "test-service-token";
process.env.OSD_ALLOWED_ORIGINS = "http://localhost:4173";

const { createServer } = await import("./server.mjs");

const sampleAnalysis = {
  summary: "A quiet establishing shot shifts into a fast action beat.",
  scenes: [{
    start_seconds: 0, end_seconds: 5,
    description: "Wide establishing shot followed by visible movement.",
    visible_evidence: "The sampled frames show a wide setting and a later close view with movement.",
    mood: "anticipatory", energy: "rising", confidence: 0.7
  }],
  cues: [{
    category: "music", start_seconds: 0, end_seconds: 5,
    description: "Start with a restrained low-texture pulse and build only after the action becomes clear.",
    rationale: "Keeps the opening spacious while allowing energy to rise with the visible movement.",
    confidence: 0.65, search_terms: ["restrained cinematic pulse", "gradual tension build"]
  }],
  limitations: ["Only sampled frames were inspected; no soundtrack audio was analyzed."]
};

async function withServer(fetchImpl, fn) {
  const server = createServer({ fetchImpl });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try { await fn(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

function payload(overrides = {}) {
  return {
    durationSeconds: 5,
    intent: "Cinematic but restrained; preserve dialogue space.",
    frames: [{
      timestampSeconds: 0,
      imageDataUrl: "data:image/jpeg;base64,/9j/2Q=="
    }],
    ...overrides
  };
}

test("health reports configuration without returning secrets", async () => {
  await withServer(fetch, async (base) => {
    const response = await fetch(`${base}/v1/health`);
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.configured, true);
    assert.equal(JSON.stringify(data).includes("test-provider-key-not-real"), false);
    assert.equal(data.limits.maxFrames, 12);
  });
});

test("analysis requires service authentication", async () => {
  await withServer(fetch, async (base) => {
    const response = await fetch(`${base}/v1/analyze`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(payload())
    });
    assert.equal(response.status, 401);
  });
});

test("rejects overlong clips before calling the model", async () => {
  let calls = 0;
  await withServer(async () => { calls++; throw new Error("provider should not be called"); }, async (base) => {
    const response = await fetch(`${base}/v1/analyze`, {
      method: "POST",
      headers: { authorization: "Bearer test-service-token", "content-type": "application/json" },
      body: JSON.stringify(payload({ durationSeconds: 601 }))
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /no more than 600/);
    assert.equal(calls, 0);
  });
});

test("valid sampled-frame request returns schema-checked, bounded cue recommendations", async () => {
  let providerBody;
  const fakeFetch = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options.headers.authorization, "Bearer test-provider-key-not-real");
    providerBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ output_text: JSON.stringify(sampleAnalysis) }) };
  };
  await withServer(fakeFetch, async (base) => {
    const response = await fetch(`${base}/v1/analyze`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-service-token",
        "content-type": "application/json",
        origin: "http://localhost:4173"
      },
      body: JSON.stringify(payload())
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.status, "completed");
    assert.equal(data.coverage, "sparse sampled frames only; audio was not analyzed");
    assert.equal(data.analysis.cues[0].category, "music");
    assert.equal(providerBody.store, false);
    assert.equal(providerBody.text.format.name, "osd_sound_plan");
    assert.ok(providerBody.input[0].content.some((part) => part.type === "input_image"));
  });
});

test("audio analysis requires a supported format and returns validated audio cues", async () => {
  let providerBody;
  const audioResult = {
    summary: "Speech is present over a soft, sustained musical bed; some words may be masked.",
    scenes: [{
      start_seconds: 0, end_seconds: 5,
      description: "Speech over a sustained background layer.",
      visible_evidence: "Audible speech and a continuous tonal bed are discernible in the recording.",
      mood: "reflective", energy: "low", confidence: 0.72
    }],
    cues: [{
      category: "music", start_seconds: 0, end_seconds: 5,
      description: "Lower background music during speech and preserve natural voice dynamics.",
      rationale: "The background layer appears to compete with speech in parts of the clip.",
      confidence: 0.68, search_terms: ["restrained underscore", "dialogue-friendly background"]
    }],
    limitations: ["Speech transcription and exact event timestamps are not guaranteed."]
  };
  const fakeFetch = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    providerBody = JSON.parse(options.body);
    assert.equal(providerBody.model, "gpt-audio-1.5");
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(audioResult) } }] }) };
  };
  await withServer(fakeFetch, async (base) => {
    const response = await fetch(`${base}/v1/analyze-audio`, {
      method: "POST",
      headers: { authorization: "Bearer test-service-token", "content-type": "application/json" },
      body: JSON.stringify({
        durationSeconds: 5,
        audioDataUrl: "data:audio/wav;base64,UklGRg==",
        intent: "Preserve the narrator's natural performance."
      })
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.method, "audio-aware-model");
    assert.equal(data.coverage, "audio input analyzed; timestamps are model estimates and must be reviewed");
    assert.equal(data.analysis.cues[0].category, "music");
    assert.equal(providerBody.modalities[0], "text");
    assert.ok(providerBody.messages[0].content.some((part) => part.type === "input_audio"));
    assert.equal(providerBody.store, false);
  });
});

test("audio analysis rejects unsupported formats before provider access", async () => {
  let calls = 0;
  await withServer(async () => { calls++; throw new Error("provider should not be called"); }, async (base) => {
    const response = await fetch(`${base}/v1/analyze-audio`, {
      method: "POST",
      headers: { authorization: "Bearer test-service-token", "content-type": "application/json" },
      body: JSON.stringify({ durationSeconds: 3, audioDataUrl: "data:audio/webm;base64,AAAA" })
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /WAV or MP3/);
    assert.equal(calls, 0);
  });
});

test("rejects out-of-range timestamps from the provider", async () => {
  const invalid = structuredClone(sampleAnalysis);
  invalid.cues[0].end_seconds = 9;
  await withServer(async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify(invalid) }) }), async (base) => {
    const response = await fetch(`${base}/v1/analyze`, {
      method: "POST",
      headers: { authorization: "Bearer test-service-token", "content-type": "application/json" },
      body: JSON.stringify(payload())
    });
    assert.equal(response.status, 502);
    const data = await response.json();
    assert.equal(data.status, "failed");
    assert.match(data.error, /out-of-range/);
  });
});
