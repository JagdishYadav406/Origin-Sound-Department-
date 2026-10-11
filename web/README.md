# OSD Web Edition

This is the standalone browser edition of Origin Sound Department. It processes user-selected audio locally in a modern browser; source media is not uploaded to an OSD server.

## Implemented in this candidate

- Dialogue, Music, SFX and Ambience tracks
- Local mono/stereo audio import and SHA-256 fingerprints where browser support permits
- Track gain, reversible three-band peaking EQ (bass 120 Hz, mid 1 kHz, treble 8 kHz), pan/stereo balance, offset, trim and fades; master-bus trim
- EQ is applied non-destructively to render-time working copies; neutral 0 dB settings preserve the original decoded samples
- Stereo WAV rendering, pre-render peak checks, WAV/PCM integrity checks and rendered preview
- Project JSON save/load and session evidence report
- Conservative memory preflight before full compressed-file read/decode and post-decode estimate
- Explicit QC and delivery limitations

## Known gaps

- No dialogue separation, compressor, limiter, Foley generation or AI sound design
- No LUFS integrated loudness or standards-compliant true-peak measurement
- No direct video muxing; export the WAV and assemble it in a video editor
- Only mono/stereo sources are accepted
- Browser download completion and actual device playback are not independently verified
- Runtime testing is still required, especially on the Samsung Galaxy A20

## Run

Open `index.html` in a modern browser, or deploy this directory as a static site. Keep original media and project JSON backups separately.

This is a reconstructed functional continuation, not a claim that unrecovered historical OSD source has been restored exactly.
