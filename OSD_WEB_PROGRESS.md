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
