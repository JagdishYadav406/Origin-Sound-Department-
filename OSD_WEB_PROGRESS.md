# OSD Web Edition progress

## 2026-10-11 — Web-first continuation

- User clarified the intended deliverable is the OSD web version, not the APK.
- Created dedicated `web-edition` branch from main to isolate web work from Android changes.
- Added preserved standalone OSD source as `web/index.html`.
- Added local-file metadata preflight before full compressed-file read/decode, conservative memory estimate, and post-decode estimate. Rejected replacements retain the previously loaded source.
- Added static-safety tests and inline JavaScript syntax CI check.
- Added a GitHub Pages workflow that verifies the web app and deploys `web/` only after changes reach main.
- Current features: four-track local mixing, gain/offset/trim/fades, master trim, stereo WAV render, project JSON save/load, evidence report.
- Known gaps: dialogue separation, EQ/dynamics/limiter, LUFS, standards-compliant true-peak, video muxing. Do not describe as the complete autonomous OSD department.
- Runtime status: browser/device operation is NOT VERIFIED. Earlier Chromium attempts were blocked by the session environment. No physical-device pass claimed.


## 2026-10-11 — Release preparation correction

- Preserved the Android repository's root README; web-specific instructions are in `web/README.md`.
- CI test invocation runs the test file directly to avoid package-name collisions.
- Pages configuration requests enablement explicitly; deployment remains contingent on workflow success.


## 2026-10-11 — Pages permission correction

- The first deployment attempt passed verification but failed at Pages configuration. A follow-up using an unsupported `administration` GITHUB_TOKEN permission caused the workflow to be rejected before jobs were created; this was caught in Actions and is being removed.
- Deployment workflow no longer attempts to enable Pages using a GITHUB_TOKEN. Repository Pages must first be enabled once in Settings → Pages with the build source set to GitHub Actions. Once that setting is enabled, the workflow can deploy the verified `web/` directory.
- Do not claim a live URL until the deploy job succeeds and the deployed URL is checked.


## 2026-10-11 — Web regression coverage expansion

- Created isolated branch `test/web-browser-smoke`; no change has been made to `main` by this branch action.
- Expanded static regression coverage for project save/load and evidence controls, local-media policy, pre-render clipping gate, serialized WAV/PCM integrity checks, mobile breakpoints, keyboard focus visibility, and reduced-motion styling.
- These are source-level regression checks, not a browser runtime test. The app still requires successful CI and real-browser/device acceptance before its runtime status can change from NOT VERIFIED.
- Current source under test: `web/index.html`, blob SHA `6ebb003e4763e05ef68a48702d8686e1236c2c73`.


## 2026-10-11 — Web deployment checkpoint

- PR #24 merged to main as commit `8a9d25741fcda41ac35483a112b2b7f428661d29`.
- GitHub Actions run `38117230688` completed successfully. The verify job passed the expanded Python static-safety tests and Node JavaScript syntax check. The deploy job passed GitHub Pages configuration, uploaded the `web/` artifact, and completed the deployment action.
- This verifies that GitHub's deployment workflow completed. The live public URL and actual browser rendering have not been independently verified from this session; do not treat deployment success as device/runtime acceptance.
- Next acceptance step: open the Pages URL shown by the deployment environment in a browser, then test on the user's Galaxy A20 with small real audio files before trying larger media.
- Functional limitations remain: no dialogue separation, EQ/dynamics/limiter, LUFS, standards-compliant true-peak, or direct video muxing. The browser edition is an early multi-track mixing tool, not the full autonomous OSD department.


## 2026-10-11 — Chromium runtime smoke test

- Added `tests/web_browser_smoke.mjs` and wired it into the web verification job before deployment.
- PR #25 merged to main as `f3a06e762d5250fff96dfcb9cd73b25cec02650a`.
- The PR's GitHub Actions web verification run `38118702012` completed successfully, including Chromium installation and the runtime smoke test for generated local WAV import, memory preflight/post-decode checks, stereo WAV render, serialized PCM/WAV integrity, local Blob preview, and project JSON download/source fingerprint.
- This is automated Chromium CI evidence only. It is not a physical Samsung Galaxy A20 test and does not establish that the user can access the public Pages URL from their phone.
- The post-merge main deployment run `38118741123` subsequently completed successfully: both verification and deployment jobs passed, including GitHub Pages configuration, artifact upload, and deploy action. The published URL and rendering on the user's phone still have not been independently verified from this session.


## 2026-10-11 — Three-band per-track EQ implementation candidate

- Created isolated branch `feature/per-track-three-band-eq` from `main`; the default branch remains unchanged while this candidate is tested.
- Added independent Bass (120 Hz), Mid (1 kHz), and Treble (8 kHz) peaking-EQ gain controls for Dialogue, Music, SFX, and Ambience, each adjustable from -12 dB to +12 dB in 0.5 dB steps. All default to 0 dB; originals are not modified.
- The EQ runs on temporary render-time sample copies, leaving the imported AudioBuffers untouched. The render working-memory estimate now reserves an additional decoded-size copy for the EQ processing path.
- Project schema version advanced to 4; loading versions 1–3 remains supported and defaults the new EQ bands to 0 dB. EQ settings are included in the evidence report. Reset now returns all three bands to 0 dB.
- Extended the Chromium smoke test to check the controls, render the same low-frequency test source with bass EQ enabled, assert that serialized PCM changes, and confirm EQ values persist in saved project JSON.
- Candidate source/test commit `98e3125d90df3c81c778aa2af08a99e8d84cf8de` passed GitHub Actions web verification run `38120378125`: static safety tests, inline JavaScript syntax check, Chromium source import, memory preflight/post-decode checks, stereo WAV render and serialized PCM QC, EQ-driven PCM change, and project JSON persistence all passed. The first run at `10dd25...` exposed an over-escaped test assertion; that test was corrected and the follow-up passed.
- At the time of this log entry, the candidate PR remains open and unmerged. The PR's deploy job is skipped as expected; a successful post-merge main workflow is still required to confirm deployment. Physical Galaxy A20 compatibility remains untested.
- Limitations: this is three fixed-frequency peaking bands, not a full parametric equalizer; no EQ curve graph, compressor, limiter, LUFS, standards-compliant true-peak, or video muxing has been added.


## 2026-10-11 — EQ candidate browser test passed

- GitHub Actions web verification run `38120378125` completed successfully for candidate commit `98e3125d90df3c81c778aa2af08a99e8d84cf8de`. The Chromium smoke test demonstrated that raising the dialogue bass band changes rendered PCM while WAV integrity checks still pass, and the saved project retains the EQ value.
- Pull request #26: https://github.com/JagdishYadav406/Origin-Sound-Department-/pull/26. Not merged at this checkpoint; deployment to the live Pages site and physical phone acceptance remain separate gates.


## 2026-10-11 — Per-track pan/balance candidate

- Created isolated branch `feature/per-track-pan-balance` from main after the EQ change was merged.
- Added a Pan / balance control to Dialogue, Music, SFX and Ambience, centered by default. The control is attenuation-only: moving left reduces the right channel; moving right reduces the left channel. It never boosts either side, so it cannot create additional peak level by itself. On mono sources this produces a left/right placement; on stereo sources it acts as channel balance rather than stereo-width processing.
- Project schema advanced to version 5; versions 1–4 default pan to center. Pan values are included in evidence and project JSON, reset returns to center, and render logs record the setting.
- Extended Chromium smoke test to hard-pan the generated mono source left and assert that the serialized WAV's right channel is silent, while checking pan persists in the saved project.
- Candidate app/test changes are committed on this branch; CI has not yet completed for this candidate. Do not merge until browser verification passes. Device compatibility remains unverified.


## 2026-10-11 — EQ release merged and deployed

- PR #26 was squash-merged to main as commit `39b4e2f83468365466cfdc0447d6328aaef004a7`.
- Candidate Chromium verification passed on PR run `38120378125`; after merge, main web workflow run `38120477121` completed successfully, including verification and GitHub Pages deployment.
- EQ is now part of the main web edition. The physical Galaxy A20 still has not been tested; live site accessibility/playback on that device remains an acceptance step.


## 2026-10-11 — Pan/balance release merged and deployed

- PR #27 was squash-merged to main as commit `e680d49fc0b3b6c5dede2777a64f453dd2f5b80d`.
- Web verification run `38120597468` passed the Chromium smoke test, including hard-left mono panning, right-channel silence, WAV integrity checks, and project persistence.
- Post-merge main workflow run `38120655145` completed successfully; both verification and GitHub Pages deployment passed.
- The live Pages environment reported by the deployment workflow is `https://jagdishyadav406.github.io/Origin-Sound-Department-/`. This is deployment evidence, not physical-device acceptance. The user's Galaxy A20 and actual download/playback remain untested.
- Main now includes three-band per-track EQ and attenuation-only pan/balance. Remaining core gaps include dynamics/limiting, integrated LUFS, standards-compliant true-peak, dialogue separation, and direct video muxing.


## 2026-10-11 — Per-track mute/solo implementation candidate

- Created isolated branch `feature/track-mute-solo` from main; main remains unchanged pending CI evidence.
- Added accessible per-track Mute and Solo buttons for Dialogue, Music, SFX, and Ambience. Mute excludes a track from the render; when one or more tracks are soloed, only soloed tracks that are not muted are rendered. Source buffers remain untouched.
- Added a safety block when mute/solo state leaves no audible tracks, rather than silently rendering an empty mix.
- Project schema advanced to v6. Mute/solo state is saved per track and restored from v6 projects; v1–v5 projects default both states off. Session evidence snapshots now include mute/solo states.
- Added Chromium smoke coverage for mute-to-digital-silence, solo isolation with a second loaded track, and project-state persistence.
- Candidate commits: app `4dc186b53dadf6fed17250e9e949ac449c90304a`; browser test `3a7615df11eb54405d585f11d39cc45084392b91`; README update `1b310bf3f509a5e82ef13eb50b46e7e7615c38ff`.
- Status at checkpoint: candidate changes are not merged. CI must pass before release. Phone compatibility remains unverified.

## 2026-10-11 — Video study, cue export, and extraction checkpoint

- PR #31 corrected the web capability notice so it accurately describes the implemented three-band EQ; merged to main as commit `afb607d3cfcd3670fcbc8ccca7f3195a2bfcb469`.
- PR #32 marks prior mix previews stale after any relevant setting changes; merged as `de36c9ef0fb8f1927908294dd8e5c098a66f8155`. This prevents an old render preview from being mistaken for the current mix.
- PR #33 added local video reference preview and timestamped edit cues, with project schema v7 and regression tests; merged as `6801e7ea7342eaf8598c46b0a39d953986c4fb3f`.
- PR #34 added CSV export for time-coded video study cues, including spreadsheet-compatible BOM/line endings and regression assertions; merged as `3dd75bc122babfdbca402dae8949864947c9a0c5`.
- PR #35 added experimental local reference-video audio capture into one selected mix track. It uses browser `captureStream`/`mozCaptureStream` and `MediaRecorder`, runs in real time, and rejects clips longer than 10 minutes, unsupported APIs, missing captured audio, or conservative memory-budget failures. Captured audio is passed to the existing track import validation pipeline. Main merge commit: `a8e604854663578cbce53b30b0aaeb906b4f99f1`.
- CI after PR #35: main web verification/deployment run `38142107646` and Android build run `38142107670` completed successfully. This is CI evidence only, not Galaxy A20 acceptance.
- Improvement review found two safety/documentation gaps in the experimental capture flow: browser MediaRecorder may re-encode audio (not bit-perfect), and replacing the reference video during capture must cancel/discard the in-flight capture.
- PR #36 implements both corrections and adds regression assertions. Candidate head `7d3bd7936d082aecd459892fc6ed2ec7310f8120`. Web workflow `38142594369` and Android workflow `38142594474` completed successfully on this branch. **PR #36 remains open/unmerged at this checkpoint; main is unchanged by PR #36.**
- Next: merge PR #36 only after reviewing the passing checks; then test short video capture on Android Chrome, checking browser support, output decode, duration/synchronization, failure recovery, and source preservation. Do not describe capture as reliable on-device until those tests are performed.
- Known limitations remain: capture is browser-dependent and real-time, may re-encode audio, has no frame-accurate sync guarantee, does not perform AI scene understanding, and does not mux the final mix back into video.
