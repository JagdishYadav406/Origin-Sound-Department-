# OSD AI Sound Director — Integration Contract

**Status: specification only. The public static web edition does not yet have a connected AI inference service.**

## Product behavior

The Sound Director is the main OSD workflow, not a decorative chatbot. Given a user-selected video clip and optional dialogue/music/SFX stems, it should produce a time-coded, reviewable sound-design plan that the user can audition, edit, accept, reject, and send to the mixer.

Required output:
- scene/shot boundaries with timestamps and confidence;
- observable action and transition descriptions, distinguishing visible evidence from inference;
- dialogue-presence and speech-activity intervals (not fabricated transcripts);
- mood, energy, pacing, and continuity recommendations with reasons;
- BGM direction and timing, including where to duck or leave dialogue space;
- SFX and ambience cue proposals with timestamps, duration, purpose, and intensity;
- references to actual library asset IDs when available, or clearly labelled search terms when no matching asset exists;
- warnings about uncertainty, codec/model limits, unsupported media, and incomplete analysis.

AI suggestions are proposals, never silently applied processing. Users must be able to edit every cue and audition it before adding it to a mix.

## Proposed service boundary

The static browser app calls a separately deployed HTTPS service configured as `OSD_AI_API_BASE_URL`. The provider API key stays on the service and must never be shipped in browser JavaScript, HTML, project JSON, logs, or Git history.

Suggested endpoints:
- `GET /v1/health` — provider/configuration readiness, without returning secrets.
- `POST /v1/analyze` — accepts a job ID, selected clip metadata, and bounded video-frame/audio-analysis inputs; returns a job ID and accepted limits.
- `GET /v1/analyze/{jobId}` — returns queued/running/completed/failed state and progress.
- `GET /v1/analyze/{jobId}/result` — returns a schema-validated analysis with time-coded cues.
- `POST /v1/library/search` — searches indexed assets and returns real asset IDs, duration, licence/provenance, and preview URLs where available.

The service must enforce payload size, frame-count, clip-duration, rate, concurrency, and spend limits; authenticate users or use a deployment-specific access policy; validate MIME types and decoded media; and apply retention/deletion rules. CORS is not authentication. API keys must not be placed in the static site.

## Result schema principles

Every timestamp must be finite, non-negative, and inside the inspected clip duration. Every cue has a stable ID, category (`music`, `sfx`, `ambience`, `dialogue`, or `transition`), start/end times, a concise description, rationale, confidence, and status (`proposed`, `accepted`, `rejected`, or `edited`). Confidence is not proof. Unsupported claims must be marked unknown. Library matches must refer to real indexed assets; otherwise return search terms and say that no asset has been selected.

## Privacy and provenance

- Local media remains local unless the user explicitly starts an analysis job and is shown what data will be sent.
- Show whether video frames, audio, or both are being sent; let the user cancel and delete the job.
- Record model/service identifier, request time, analyzed duration, sampled timestamps, errors, and result hash in the evidence log.
- Never claim a full-video analysis if only sampled frames or a bounded excerpt were inspected.
- Do not claim that a cue is copyright-safe; show licence/provenance from the asset catalogue.

## Acceptance tests before calling it functional

1. No configured service: show **AI unavailable / not connected** and keep the manual workflow usable.
2. Valid clip: return time-coded, schema-valid results that fit the actual duration.
3. Malformed or out-of-range result: reject it safely and log a failure, not partial success.
4. Provider timeout, rate limit, network loss, and user cancellation: report honest status and permit retry.
5. No matching asset: offer search terms; do not invent a downloadable sound.
6. Privacy consent, payload bounds, and key-leak checks pass.
7. Accepted cue becomes an editable project item and can be auditioned before rendering.
8. Full Chromium workflow, then separate Android Chrome testing, passes on real representative clips.

## Not yet implemented

This document does not itself provide AI scene understanding, speech analysis, music/SFX selection, a sound-library index, an inference backend, or deployment credentials. These remain required implementation work; the UI must not imply otherwise.
