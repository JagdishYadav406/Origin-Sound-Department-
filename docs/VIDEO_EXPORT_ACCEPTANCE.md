# OSD video-plus-soundtrack export — implementation and acceptance gates

Status: **NOT IMPLEMENTED / NOT ACCEPTED**. The current editor produces a separately downloadable stereo PCM16 WAV. It does not mux that WAV into the selected video.

## Safety and product contract

- Never modify or overwrite the selected original video. The source file remains a read-only reference.
- Export is a separate, explicit user action; rendering a mix must never trigger a download.
- Do not label a lossy/re-encoded export as bit-perfect or lossless.
- Never claim a download succeeded merely because a browser download was requested.
- A failed/cancelled export must not create a success claim or invalidate the already rendered WAV.
- If browser codec/recording capabilities are missing, report unsupported and keep the WAV export available.
- Do not silently stretch, truncate, loop, or shift audio/video to force duration alignment. Show both durations and require an explicit user decision for a mismatch.
- Preserve evidence: source filename/size, selected codec/container, mix duration, video duration, output byte size, timestamps, result status and limitations. A browser-side hash may be recorded only if actually calculated.

## Candidate implementation paths

1. **Preferred for deterministic production output:** an optional server/worker using a pinned FFmpeg build, with explicit upload consent, strict request/resource limits, temporary-file cleanup, and server-side output verification. Do not send media to a server without clear opt-in.
2. **Browser-only fallback:** experimental canvas capture plus Web Audio and MediaRecorder, only where the browser reports support. This re-encodes video and audio in real time, depends on codec support and device performance, and must be labelled experimental. Do not assume this preserves source quality.

Do not bundle a large codec runtime or add a remote media service without weighing download size, Android memory, CPU time, licensing, and privacy. Do not add hidden third-party upload endpoints.

## Required acceptance tests before release

- Feature detection: missing canvas capture, AudioContext, MediaRecorder, or supported MIME type returns a clear unsupported status and leaves original media and WAV export intact.
- Consent: no media leaves the device unless the user explicitly opts in to a clearly identified remote service.
- Duration alignment: test exact match, sub-tolerance match, audio shorter, video shorter, zero/unknown duration, and duration changes while exporting.
- Sync: verify the output begins at the intended 00:00 alignment; no silent start offset or unannounced drift.
- Integrity: parse output container metadata and decode the produced file; verify nonzero size, valid streams, expected duration within documented tolerance, and presence of both video and the new soundtrack.
- Audio routing: output uses the currently validated OSD mix, not the original reference video's audio, unless a future explicit option says otherwise.
- Failure/cancel: cancel before start, during capture, on source seek/pause, and on recorder/decoder failure. Release media tracks, object URLs, and AudioContext resources; never report a successful export on failure.
- Download semantics: output is prepared first; download happens only after the user presses an explicit export/download action. Browser receipt remains unverified.
- Regression: existing original-source preservation, project save/load, audio import/render/QC, explicit WAV download and 360×800 mobile-layout tests continue to pass.
- Physical-device acceptance: test on the Samsung Galaxy A20/Android browser with representative supported media, short clips first, memory pressure, cancellation and output playback. Desktop Chromium emulation is not a substitute.

## Release gate

Keep this feature marked experimental until all relevant browser tests pass and the output is decoded/inspected. Do not merge a UI that implies video muxing exists before a working implementation is connected. Update `OSD_WEB_PROGRESS.md` with exact commit, test run, output format and known limitations after each verified checkpoint.
