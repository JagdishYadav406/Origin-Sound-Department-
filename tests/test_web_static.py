import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = ROOT / "web" / "index.html"


class OSDWebStaticSafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = HTML.read_text(encoding="utf-8")
        scripts = re.findall(r"<script\b[^>]*>(.*?)</script>", cls.html, re.I | re.S)
        cls.inline_script = "\n".join(scripts)

    def test_single_self_contained_page_and_no_remote_scripts(self):
        self.assertTrue(self.html.lstrip().lower().startswith("<!doctype html>"))
        self.assertNotRegex(self.html, r"<script\b[^>]+src\s*=")
        self.assertNotRegex(self.html, r"<(?:iframe|object|embed)\b")

    def test_ids_are_unique_and_literal_id_references_resolve(self):
        ids = re.findall(r"""\bid=["\']([^"\']+)["\']""", self.html)
        self.assertEqual(len(ids), len(set(ids)), "duplicate HTML ids found")
        available = set(ids)
        refs = set(re.findall(r"""\$\([\'"]([A-Za-z][A-Za-z0-9_-]*)[\'"]\)""", self.inline_script))
        self.assertTrue(refs.issubset(available), "missing ids: " + repr(sorted(refs - available)))

    def test_memory_preflight_precedes_full_read_and_decode(self):
        self.assertIn("async function probeDuration(file)", self.inline_script)
        self.assertIn("SOURCE_MEMORY_PREFLIGHT", self.inline_script)
        self.assertIn("SOURCE_MEMORY_POST_DECODE_CHECK", self.inline_script)
        self.assertLess(self.inline_script.index("probeDuration(f)"), self.inline_script.index("f.arrayBuffer()"))
        self.assertLess(self.inline_script.index("SOURCE_MEMORY_PREFLIGHT"), self.inline_script.index("decodeAudioData(bytes)"))

    def test_safeguards_and_limits_are_explicit(self):
        self.assertIn("previous source remains loaded", self.html)
        self.assertIn("No LUFS loudness measurement", self.inline_script)
        self.assertIn("No standards-compliant true-peak measurement", self.inline_script)
        self.assertIn("No direct video muxing", self.inline_script)
        self.assertIn("Three-band EQ is implemented.", self.html)
        self.assertNotIn("Sources with more than two channels are rejected rather than silently remapped. EQ, compression", self.html)
        self.assertIn("OSD-WEB-QC-EVIDENCE", self.inline_script)
        self.assertIn("Previous render — OUTDATED", self.html)
        self.assertIn("Latest completed render — CURRENT", self.inline_script)
        self.assertIn("markMixPreviewStale", self.inline_script)
        self.assertIn('id="referenceVideo"', self.html)
        self.assertIn('id="referenceVideoPlayer"', self.html)
        self.assertIn('id="addVideoCue"', self.html)
        self.assertIn('id="exportVideoCues"', self.html)
        self.assertIn("VIDEO_CUES_EXPORTED", self.inline_script)
        self.assertIn("function csvCell(value)", self.inline_script)
        self.assertIn("OSD-video-cues-", self.inline_script)
        self.assertIn("videoCues:videoCues.map", self.inline_script)
        self.assertIn("automatic scene interpretation", self.html)
        self.assertIn("videoReference:videoFile?", self.inline_script)
        self.assertIn('id="extractVideoAudio"', self.html)
        self.assertIn('id="cancelVideoAudio"', self.html)
        self.assertIn('id="videoAudioTarget"', self.html)
        self.assertIn("VIDEO_AUDIO_CAPTURE_STARTED", self.inline_script)
        self.assertIn("VIDEO_AUDIO_CAPTURE_PREFLIGHT", self.inline_script)
        self.assertIn("MediaRecorder.isTypeSupported", self.inline_script)
        self.assertIn("duration>600", self.inline_script)
        self.assertIn("normal duration, memory, decode and integrity checks", self.html)

    def test_ai_sound_director_requires_explicit_consent_and_uses_bounded_sampled_frames(self):
        self.assertIn('id="analyzeVideoAI"', self.html)
        self.assertIn('id="aiServiceToken"', self.html)
        self.assertIn('id="aiUploadConsent"', self.html)
        self.assertIn("async function sampleVideoFrames(token)", self.inline_script)
        self.assertIn("Math.min(8,Math.max(4,Math.ceil(duration/30)))", self.inline_script)
        self.assertIn("!$('aiUploadConsent').checked", self.inline_script)
        self.assertIn("original_video_file_uploaded=false", self.inline_script)
        self.assertIn("audio_uploaded=false", self.inline_script)
        self.assertIn("sampled-frame visual analysis", self.html)
        self.assertIn("No sound is downloaded or automatically mixed", self.html)
        self.assertIn("aiAnalysisController.abort()", self.inline_script)

    def test_ai_audio_analysis_requires_explicit_per_file_consent_and_bounded_upload(self):
        self.assertIn('id="aiAudioFile"', self.html)
        self.assertIn('id="aiAudioConsent"', self.html)
        self.assertIn('id="analyzeAudioAI"', self.html)
        self.assertIn("/v1/analyze-audio", self.inline_script)
        self.assertIn("file.size>4_500_000", self.inline_script)
        self.assertIn("audioMeta>90", self.inline_script)
        self.assertIn("explicit_consent=true audio_uploaded=true", self.inline_script)
        self.assertIn("$('aiAudioConsent').checked=false", self.inline_script)
        self.assertIn("$('aiUploadConsent').checked=false", self.inline_script)
        self.assertIn("renderAIResult(data,'audio')", self.inline_script)
        self.assertIn("Audio AI is separate from local measurements", self.html)

    def test_local_audio_evidence_and_sound_library_are_explicit_and_session_scoped(self):
        self.assertIn('id="audioEvidence"', self.html)
        self.assertIn('id="evidenceAudioFile"', self.html)
        self.assertIn('id="analyzeAudioEvidence"', self.html)
        self.assertIn("decodeAudioData(bytes.slice(0))", self.inline_script)
        self.assertIn("LOCAL_AUDIO_MEASURED", self.inline_script)
        self.assertIn("Low-level spans can be silence, quiet ambience, or soft performance", self.inline_script)
        self.assertIn('id="soundLibraryFiles"', self.html)
        self.assertIn("LOCAL_SOUND_LIBRARY_INDEXED", self.inline_script)
        self.assertIn("LOCAL_SOUND_CUE_MATCH", self.inline_script)
        self.assertIn("audio_embeddings=false", self.inline_script)
        self.assertIn("persisted=false", self.inline_script)
        self.assertIn("not a verified sonic match", self.inline_script)
        self.assertIn("does not identify speech, emotions, or sound events", self.html)

    def test_project_recovery_controls_and_local_media_policy_exist(self):
        for element_id in ("saveProject", "loadProjectButton", "exportReport", "loadProjectFile"):
            self.assertRegex(self.html, rf"""id=["']{element_id}["']""")
        self.assertIn("Audio and video media are not embedded", self.inline_script)
        self.assertIn("has not been re-verified in this session", self.inline_script)

    def test_mix_render_has_preallocation_clipping_gate_and_serialized_pcm_checks(self):
        self.assertIn("PRE_RENDER_QC_BLOCKED", self.inline_script)
        self.assertIn("output_allocated=false", self.inline_script)
        self.assertIn("Independent WAV header/format validation failed", self.inline_script)
        self.assertIn("serialized_pcm_peak_dbfs", self.inline_script)
        self.assertIn("blob_size_check=PASS", self.inline_script)

    def test_old_mix_preview_is_marked_outdated_after_edits(self):
        self.assertIn('id="mixPreviewStatus"', self.html)
        self.assertIn('id="mixPreviewNotice"', self.html)
        self.assertIn("function markMixPreviewStale(reason)", self.inline_script)
        self.assertIn("Previous render — OUTDATED", self.inline_script)
        self.assertIn("Latest completed render — CURRENT", self.inline_script)
        self.assertIn("Render again before exporting or using it as the current mix.", self.inline_script)

    def test_mobile_layout_and_keyboard_focus_rules_remain_present(self):
        self.assertIn("@media(max-width:560px)", self.html)
        self.assertIn("@media(max-width:360px)", self.html)
        self.assertIn(":focus-visible", self.html)
        self.assertIn("prefers-reduced-motion:reduce", self.html)


if __name__ == "__main__":
    unittest.main()
