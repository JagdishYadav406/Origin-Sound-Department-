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
- Current branch head: `f7a609da8d2f0d2d320e6ae0a9302fb43be40a28` (latest change is the browser-test event dispatch fix).
- Verification status: changes have been authored but GitHub Actions has not yet been observed for this branch. Do not merge or call this feature verified until the browser test and all required CI checks pass. Physical Galaxy A20 compatibility remains untested.
- Limitations: this is three fixed-frequency peaking bands, not a full parametric equalizer; no EQ curve graph, compressor, limiter, LUFS, standards-compliant true-peak, or video muxing has been added.
