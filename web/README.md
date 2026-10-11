# OSD Web Edition

Origin Sound Department is a self-contained browser-based soundtrack workspace. User-selected media is processed locally by the browser for ordinary editing and rendering. AI analysis is a separate, optional service request that sends only the media the user explicitly consents to share.

## Available production tools

- Four source tracks: Dialogue, Music, SFX and Ambience.
- Local audio import, browser decoding and SHA-256 source fingerprints where supported.
- Track gain, mute/solo, three-band peaking EQ, high-pass filtering, linked-stereo compression, pan/balance, start offset, trim and fades.
- Optional per-track low-level noise gate with threshold and attenuation controls, off by default. This can reduce quieter material between louder passages; it is not spectral denoising, cannot reliably separate speech from noise, and may attenuate quiet speech or effects if set too aggressively.
- Dialogue starting presets (Natural Voice, Reduce Low Rumble, Clarity, More Dynamic Control, Reset) that set editable parameters; they are not noise removal or quality guarantees.
- Dialogue-aware music ducking using an envelope follower; it is not speech recognition.
- Master-bus gain trim and a pre-render full-scale/clipping gate. There is no automatic limiter or loudness normalization.
- Stereo PCM16 WAV rendering, browser preview, explicit WAV download, pre-render sample peak scan, serialized PCM/header/frame-count checks and render-staleness protection.
- Project JSON save/load, source identity checks where supported, and a session QC/evidence report.
- AI Sound Director: optional service-backed sampled-frame visual analysis and separate consented audio-aware analysis (WAV/MP3 up to 90 seconds), plus a combined time-coded proposal plan when the editor confirms both inputs start at 00:00.
- Cue-plan JSON/CSV export, time-coded video study notes, and a session-local sound library with candidate audition and text/tag matching.
- Experimental reference-video soundtrack capture in supported browsers. It runs in real time, may re-encode audio lossily, and is not bit-perfect.

## Important limits

- AI analysis requires a separately configured and reachable OSD AI service plus a valid service token. Without it, no model analysis occurs. Provider credentials belong on the server, not in this static page.
- Visual analysis samples frames rather than understanding every moment of continuous motion. Audio analysis is a separate upload, requires consent, and is bounded to 90 seconds.
- Sound-library matching is based on cue text, filenames and tags—not audio embeddings, guaranteed creative fit, licensing validation or copyright clearance.
- The mixer does not automatically apply AI suggestions. Review and audition every candidate.
- The renderer does not currently mux the final soundtrack into the original video. Export the WAV and assemble it with a video editor.
- No spectral noise reduction, dereverberation, source separation, clipping repair, Foley synthesis, LUFS integrated loudness measurement, or standards-compliant true-peak meter is claimed. The low-level gate is a simple dynamics tool, not a replacement for spectral denoising.
- Stereo WAV export, browser downloads and video capture depend on browser capabilities and available memory. Download completion and playback on the user's device are not independently verified.
- The web static/Chromium test suite is not a substitute for testing on the Samsung Galaxy A20 or another target device.

## Run locally or host

Open `index.html` in a compatible modern browser, or host the `web/` directory as a static site over HTTPS. The core editor does not need a server for local audio processing. AI Sound Director does need a configured backend service. Keep original media and project JSON backups separately.

This is a reconstructed functional continuation, not a claim that unrecovered historical OSD source has been restored exactly.
