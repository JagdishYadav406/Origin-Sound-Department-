# OSD Append-Only Progress Log

Entries are chronological. Add new entries at the bottom; do not edit or delete earlier entries.

## 2026-10-10 — Data Analysis / build continuity diagnosis

- Repository audited: `JagdishYadav406/Origin-Sound-Department-`.
- Main branch observed at audit: `f0ec11968531cdb9575a6c77e4ddb50e8351c8f3`.
- Latest successful workflow run observed: run `38047471228`, candidate commit `9fc867f67aff55689f16206f5f54e59298b40c11`, branch `fix/osd-launch-status-accuracy`.
- CI job steps reported success for Python regression tests, release APK build, APK presence/SHA-256 check, and artifact upload.
- Artifact observed: `OSD-1.20.0-release`, ID `11668940174`, created 2026-10-10, expiry 2027-01-08; checksum and APK were included in artifact paths.
- Confirmed process weakness: temporary Data Analysis/Python sessions are not durable storage, and chat summaries are not a byte-exact source backup. Resume from Git commits and workflow artifacts, not recollection.
- Confirmed evidence limitation: this CI run does not prove physical-device installation, successful launch, or the full real-audio workflow. Those remain UNKNOWN until tested and documented.
- Created continuity protocol at `OSD_BUILD_CONTINUITY.md` on branch `ops/osd-durable-recovery`.
- Protocol commit: `2de67c1851248c38cca148e3a81a2c625f805c28`.
- Next actions: review branch diff; add durable recovery metadata to the next release/checkpoint; verify or rerun build on the exact intended release commit; download and independently retain APK+SHA; perform physical-device end-to-end tests; do not call OSD fully verified before these pass.

## 2026-10-10 — Recovery-aware APK rebuild and Android bridge correction

- Hardened .github/workflows/osd-android-build.yml on the recovery branch so artifacts include the APK, APK SHA-256, build metadata, exact CI source archive, and source archive SHA-256. CI metadata explicitly marks device installation and full audio-workflow tests as NOT RUN BY CI.
- Created draft PR #6: https://github.com/JagdishYadav406/Origin-Sound-Department-/pull/6. It is open and not merged; main remains unchanged.
- Static Android source inspection identified an execution defect: Python passed FFmpeg command arrays beginning with ffmpeg, while FFmpegKit.execute expects only FFmpeg arguments. Corrected FfmpegBridge.execute and execute_stderr to strip the executable token while leaving FFprobe arguments intact.
- Corrected bridge commit: f1eb3ef26b763e51f02d45da48d492231c685536.
- CI run: https://github.com/JagdishYadav406/Origin-Sound-Department-/actions/runs/38047914986 — successful Python regression tests, Android release APK compilation, checksum/source provenance creation, and artifact upload.
- Tested artifact merge commit: 75ab6ff26621f6509d0ae034c6534ede13d84db7 (PR merge ref). APK size: 109,381,736 bytes. APK SHA-256: 0dd0211f4b7ddc79b263c1a4e4af786357a7e114f5a9929db7ba14dd9499103e. Source archive SHA-256: 2a0e2bd986f7f3a048733ce3090ca2f614c3e1651229f9ee6de080360e62ad6a.
- Independently downloaded the artifact ZIP and extracted the APK in the current working session; ZIP integrity and APK SHA-256 match were verified locally. APK contains DEX, AndroidManifest, Chaquopy assets, and native libraries for arm64-v8a and x86_64.
- Still UNKNOWN: install/launch on the user's phone, whether Android FFmpeg calls run correctly end-to-end on-device, media output playback, QC behavior on representative files, export usability, and whether installation over an existing build is signature-compatible. Do not mark OSD complete until these are tested.


## 2026-10-11 — Integrated Android multi-track soundtrack beta (candidate; CI pending)

- User reported that Web Edition features were not visible in OSD. Confirmed the HTML prototypes were separate artifacts and were not integrated into the Android repository.
- Created feature branch `feature/android-multitrack-stem-mix` from the inspected `main` tree at `627f9dd2f75bbda6bb29a9a73523d9f50e82f2bb`; main was not modified.
- Added a visible Android entry point: “Build multi-track soundtrack (video + 2+ audio tracks)”. Workflow selects a source video, then 2+ audio files; asks for per-track gain (-24 dB to +12 dB); assigns track roles by selection order (Dialogue, Music, Sound Effects, Ambience, then Additional track); imports each source into prefixed app-private input files; passes stem paths, roles, and gains into the existing Python processing pipeline; and enables playback/export only after delivery evidence verification.
- Hardened `mix_stems`: validates role/gain counts, finite gain values and bounds, explicitly rejects non-zero music ducking because it is not implemented, disables amix's hidden normalization so specified relative gains are preserved, and writes a floating-point PCM intermediate to avoid early PCM16 clipping before the downstream limiter.
- Added a source-vs-stem duration gate (0.15 s tolerance) so incompatible timelines fail early rather than creating a misleading output.
- Added regression tests for explicit gain use, floating-point mix output, invalid gain/role counts, unsupported ducking, and source/stem duration checks.
- Updated README with discoverability, workflow steps, current limitations, and explicit warning that timeline offsets, trims, fades, solo/mute, and per-role processing are not yet implemented in the Android workflow.
- Candidate commits created on the feature branch:
  - Android UI workflow: `c8995162cf6362b99f29c0fe3d377f66193c7149`
  - Stem gain/headroom validation: `27e5becee5585b307ea04fd7494decbe64335f17`
  - Multi-track regression tests: `18475f8dd3745a3700f815d212c62976ac3e286f`
  - Timeline compatibility validation: `292705738c065d1fc1decf5bd77e4233e06fb43b`
  - Timeline regression tests: `c14d316ad07d871e513152d3a0540aad04956380`
  - README discoverability: `8495be14af1dc742bb641f04fa82ad4c2c8c11a1`
- Status at log entry: source changes committed to feature branch; CI, APK artifact integrity, physical installation, actual multi-file selection, rendering, playback/export, and Galaxy A20 performance are still pending. Do not merge or describe this as verified until CI and runtime acceptance evidence are reviewed.


## 2026-10-11 — Follow-up guard and role-label clarification

- Fixed the Android source-picker cancellation path to reset the pending multi-track state, preventing a later ordinary media selection from unexpectedly continuing a cancelled multi-track setup.
- Clarified in README that Dialogue/Music/SFX/Ambience are currently role labels only and do not yet trigger role-specific processing.
- Follow-up commits: Android cancellation fix `1f7e4ed44e8e10dbb53132e3f292e2596529933e`; role-label clarification `2fafbb04c21495dc8024a61bad784ba078a08a54`.
- CI for the earlier candidate had passed Python regression tests and was still building the release APK when last checked. That run does not include these two follow-up commits; the updated PR head needs its own CI result.


## 2026-10-11 — Silent source video support in multitrack replacement workflow

- Review found that the shared media inspector rejected video files with no embedded audio, even though the multitrack workflow explicitly replaces the video's soundtrack. This would block valid silent-video sources.
- Added an explicit opt-in to inspect video-only sources when stem replacement is requested; ordinary single-file processing still rejects media with no audio stream.
- Added a regression test with a self-contained temporary video-only fixture. CI is running for this follow-up; results must be checked against the latest branch head before calling it verified.
- Commits: implementation `b847b904d6a99754ea9de5801fa5d14b9579506e`; regression test `0eb30c0b347090f3fe8adabeba8bcad6ad10786d`.


## 2026-10-11 — Output preservation and import-source size guard (follow-up candidate)

- Created branch `fix/output-preservation-import-verification` from the successful multi-track candidate head `7225448e6d3844b5f2663edc101e5e3ebb5b7108`; main and the existing draft PR were not modified.
- Replaced the shared output folder with a unique per-run output directory for both single-file and multi-track workflows. This removes pre-run deletion of the previous final WAV/video and evidence files, preserving earlier deliverables across subsequent runs.
- Added best-effort Android document-provider source-size inspection. When the provider exposes a non-null source byte count, OSD checks it against bytes copied; the existing copied-file size and independent SHA-256 re-read checks remain in place. If provider metadata is absent/unavailable, OSD falls back to independent copy/hash checks.
- Updated README to describe per-run output preservation.
- Added Python static regression guards for unique output paths, preservation of previous deliverables, and source-size/hash checks.
- Status: source changes prepared on an isolated branch. Python regression tests, Android release compilation/signature verification, artifact checksum validation, and physical-device tests are pending for this follow-up head. No merge or release claim made.