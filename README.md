# Origin Sound Department (OSD)

OSD is an Android audio/video processing app with a Python/FFmpeg processing core.

## Android workflows

### Single-file processing
1. Tap **Choose audio or video**.
2. Select a local source.
3. Wait for processing and QC evidence.
4. Use **Play final output** or **Save final output to device**.

### Multi-track soundtrack beta
1. Tap **Build multi-track soundtrack (video + 2+ audio tracks)**.
2. Choose the source video.
3. Select at least two audio files in the Android file picker (use multi-select).
4. For each track, enter a gain from -24 dB to +12 dB. Track roles are assigned by selection order: Dialogue, Music, Sound Effects, Ambience, then Additional track.
5. Wait for mix, master, QC, and delivery verification. Play or export the result only if OSD reports successful verification.

The source video supplies the picture; selected audio stems replace its soundtrack. The source and imported tracks are copied into OSD's app-specific storage and are not overwritten.

## Multi-track beta constraints (important)
- Tracks must be mutually compatible and their durations must match the source timeline within 0.15 seconds.
- This Android workflow currently has no timeline offsets, trims, fades, solo/mute, or per-role processing.
- Automatic music ducking is not implemented; the engine rejects non-zero ducking requests instead of silently ignoring them.
- Track gains are limited to -24 dB through +12 dB. The intermediate mix is floating-point so it does not quantize/clamp to PCM16 before the later limiter stage.
- If compatibility, measurements, integrity evidence, or QC are missing or fail, delivery is blocked.
- CI tests/builds do not establish successful installation or end-to-end operation on a physical phone. Galaxy A20 acceptance testing remains a separate required step.

See [OSD build continuity](OSD_BUILD_CONTINUITY.md) and the append-only [progress log](OSD_PROGRESS_LOG.md) for recovery and evidence rules.
