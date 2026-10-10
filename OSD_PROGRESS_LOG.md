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


## 2026-10-10 — Main build run #32 artifact independently checked

- Canonical repository: https://github.com/JagdishYadav406/Origin-Sound-Department-
- Main commit: 591cbb2d8124052227a1421f8b1f9260402fd832 ("Block unverified OSD delivery markers").
- Workflow run #32: https://github.com/JagdishYadav406/Origin-Sound-Department-/actions/runs/38053680006 — success; Python regression tests, release APK build, APK/provenance verification, and artifact upload completed.
- Artifact: OSD-1.20.0-591cbb2d8124052227a1421f8b1f9260402fd832; GitHub artifact ID 11669898114; artifact ZIP size 51,645,501 bytes; expiry 2027-01-08.
- Downloaded artifact ZIP SHA-256: c88c5fe381078d2ab806218bafd5b3e0fd8b2b61bdb235679db5f923d65d05ab; ZIP integrity passed.
- Extracted APK: app-release.apk; size 109,381,736 bytes; SHA-256 b27d8177694862ce713cf83d6547330f8ad1f08ea6b278ab56b661c4493d155e; matches SHA256SUMS.txt. APK ZIP integrity and AndroidManifest presence passed. CI provenance states APK signature verification step completed successfully.
- Build metadata confirms source commit, Java 17.0.20.1, Python 3.13.16, Gradle 8.13, and explicitly records device_install_test=NOT_RUN_BY_CI and full_audio_workflow_test=NOT_RUN_BY_CI.
- Android artifact file was materialized in the current ChatGPT runtime at /mnt/data/OSD-1.20.0-main-591cbb2d8124052227a1421f8b1f9260402fd832.apk; this runtime copy is not a durable external backup.
- Remaining acceptance tests: install/launch on Samsung Galaxy A20; real audio import and processing; verify output playback/export; test invalid input, processing failure, and missing QC measurements. These remain UNKNOWN until tested on-device.
- PR #9 (multiline true-peak parser) remains open and marked non-mergeable; main history already contains commit 95de0481b4c7fcf8df0fc51b3d0553a09c3adcde "Fix true-peak QC parser unit handling". Do not merge the stale PR blindly; inspect whether it is redundant or still contributes a needed regression before closing or updating it.
