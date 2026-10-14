# OSD Build Continuity and Recovery Protocol

Status: operational protocol draft, created 2026-10-10.
Canonical repository: https://github.com/JagdishYadav406/Origin-Sound-Department-
Protected baseline for this checkpoint: `9fc867f67aff55689f16206f5f54e59298b40c11`
Checkpoint branch: `ops/osd-durable-recovery`

## Why continuity failures recur

The project was being resumed across temporary ChatGPT/Data Analysis execution sessions. Those sessions are not durable storage: files in a runtime may disappear, while conversation summaries cannot restore exact source bytes. The repository is the durable source of truth; chat history is supporting context only.

The repository audit also found a version mismatch: the latest successful Android workflow run observed during this audit was on pull-request branch `fix/osd-launch-status-accuracy` at `9fc867f67aff55689f16206f5f54e59298b40c11`, not on `main`. The latest run completed successfully and ran Python regression tests, built a release APK, computed SHA-256, and uploaded an artifact. This proves the CI steps passed for that commit; it does **not** prove the APK was installed and fully exercised on a physical phone. Do not describe a PR build as the current main/released APK.

## Non-negotiable recovery rules

1. **Source of truth:** use the repository commit SHA and tree, never conversation recollection, as the exact source state.
2. **No silent replacement:** make changes on a new branch; preserve prior commits and release artifacts. Never force-push or overwrite a known-good checkpoint as a routine recovery step.
3. **Resume token:** every handoff records repository URL, branch, full commit SHA, workflow run URL/ID, artifact name, artifact expiry, test result, and unresolved blockers.
4. **Reproducible build:** build from a clean checkout using the versions pinned in the workflow. Record the full commit SHA with every APK.
5. **Evidence labels:** distinguish (a) source present, (b) tests passed, (c) APK built, (d) APK installed/launched, and (e) real audio workflow tested. Never infer a later level from an earlier one.
6. **Artifact integrity:** download the APK and its checksum file together. Recompute SHA-256 after download and compare it to the workflow checksum. Keep a separate local/offline copy; GitHub Actions artifacts expire.
7. **Fail closed:** if source, checksum, test output, artifact, or required runtime dependency is missing, mark that state UNKNOWN and stop release claims.
8. **Session reset:** reopen this file, inspect the repository's latest commits and workflow runs, select the newest verified checkpoint, then resume from its exact SHA. Do not recreate source files from a summary.
9. **Small changes:** one focused change per commit; run regression tests and APK build before moving forward. Keep the previous verified checkpoint intact.
10. **Phone validation:** after CI succeeds, install the exact APK on the target Android device and test launch, file import, audio processing, output creation/export, QC reporting, and failure handling. Record device/Android version and outcomes.

## Recovery sequence

1. Open the repository and inspect recent commits:
   https://github.com/JagdishYadav406/Origin-Sound-Department-/commits/main
2. Inspect Android build workflow runs:
   https://github.com/JagdishYadav406/Origin-Sound-Department-/actions
3. Choose the latest successful run for the exact commit intended for testing. Do not mix a PR artifact with `main`.
4. Download the artifact from that run's summary page. Verify the APK against the included `SHA256SUMS.txt`.
5. If the artifact has expired, rerun the workflow from the exact commit or check out that commit and rebuild. Do not substitute an APK from another commit.
6. Install and perform the physical-device tests above. Save a test report with the APK checksum.
7. Add an append-only checkpoint entry recording what changed, what was tested, evidence links, hashes, and remaining UNKNOWN items.
8. Only merge a candidate branch after reviewing its diff and confirming the intended CI run passes. The main branch is the current release candidate only after that merge.

## Checkpoint record — 2026-10-10

- Candidate branch: `fix/osd-launch-status-accuracy`
- Candidate commit: `9fc867f67aff55689f16206f5f54e59298b40c11`
- Workflow run: https://github.com/JagdishYadav406/Origin-Sound-Department-/actions/runs/38047471228
- Result: CI success; regression tests, APK build, checksum generation, and artifact upload all reported success.
- Artifact: `OSD-1.20.0-release`, created 2026-10-10, expires 2027-01-08 according to the run's artifact metadata.
- Artifact size reported by GitHub: 51,622,786 bytes (artifact ZIP, not APK size).
- Physical-device install/launch and full audio-workflow validation: **UNKNOWN / not evidenced by this CI run**.
- Main branch at audit time: `f0ec11968531cdb9575a6c77e4ddb50e8351c8f3`; candidate fixes above were not yet merged into main.

Append new checkpoint entries; do not rewrite this historical record.


## Checkpoint addendum — 2026-10-10 main build independently verified

- Main commit: `205d0dd54b3ed0077a7c557dd72f4d606baac75f`.
- Successful run: [#34 / 38054865623](https://github.com/JagdishYadav406/Origin-Sound-Department-/actions/runs/38054865623).
- Artifact: `OSD-1.20.0-205d0dd54b3ed0077a7c557dd72f4d606baac75f`, ID `11670379466`, expires 2027-01-08.
- APK SHA-256: `195325aee6f101c39fe3410b692239be8007a58d9ea783dafddb0903f34fd69f`; size 109,381,736 bytes.
- Independently downloaded artifact ZIP digest matched GitHub's digest; APK and source archive checksum manifests passed; archive listing passed; all 12 Python tests passed in a local rerun.
- The CI workflow reports APK signature verification success. These results prove artifact/build integrity, not device behavior.
- Device install/launch and the complete real-audio workflow remain UNKNOWN until tested on the Samsung Galaxy A20. Do not declare full functionality before import, processing, QC evidence, playback, export and failure cases pass.
