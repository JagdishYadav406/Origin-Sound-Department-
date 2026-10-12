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
        self.assertIn("const scoutCount=12", self.inline_script)
        self.assertIn("const selected=new Set", self.inline_script)
        self.assertIn("selected.size>=8", self.inline_script)
        self.assertIn("frames.length", self.inline_script)
        self.assertIn("!$('aiUploadConsent').checked", self.inline_script)
        self.assertIn("original_video_file_uploaded=false", self.inline_script)
        self.assertIn("audio_uploaded=false", self.inline_script)
        self.assertIn("Visual analysis samples frames", self.html)
        self.assertIn("No sound is downloaded or automatically mixed", self.html)
        self.assertIn("aiAnalysisController.abort()", self.inline_script)

    def test_dialogue_refinement_presets_are_reversible_and_disclose_limits(self):
        self.assertIn('id="dialogueRefinement"', self.html)
        for preset in ("natural", "rumble", "clarity", "dynamics", "neutral"):
            self.assertIn(f'data-dialogue-preset="{preset}"', self.html)
        self.assertIn("DIALOGUE_REFINEMENT_PRESET_APPLIED", self.inline_script)
        self.assertIn("does not remove noise, repair clipping, or guarantee intelligibility", self.inline_script)
        self.assertIn("if(rendering)", self.inline_script)

    def test_sound_director_can_combine_time_aligned_visual_and_audio_cue_proposals(self):
        self.assertIn('id="combineAIResults"', self.html)
        self.assertIn('id="aiTimelineAligned"', self.html)
        self.assertIn("aiVisualLastResult=data", self.inline_script)
        self.assertIn("aiAudioLastResult=data", self.inline_script)
        self.assertIn("aligned_start_confirmed=true auto_applied=false", self.inline_script)
        self.assertIn("AI_AUDIO_VISUAL_PLAN_COMBINED", self.inline_script)
        self.assertIn("Visual observation", self.inline_script)
        self.assertIn("Audible evidence", self.inline_script)
        self.assertIn("updateCombineAIButton()", self.inline_script)
        self.assertIn("aiVisualLastResult=null;aiAudioLastResult=null;aiCombinedLastResult=null", self.inline_script)
        self.assertIn("confirm the selected audio starts at 00:00 of this same video", self.html)

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
        self.assertIn("does not infer speech, emotions, or sound events", self.html)

    def test_audio_evidence_and_sound_library_have_separate_tool_sections(self):
        evidence = self.html.index('<section class="panel audio-evidence-panel" id="audioEvidence"')
        library = self.html.index('<section class="panel audio-evidence-panel sound-library-panel" id="soundLibraryPanel"')
        video = self.html.index('<section class="panel video-study"')
        self.assertLess(evidence, library)
        self.assertLess(library, video)
        self.assertIn('<h2 id="audioEvidenceHeading">Audio Evidence</h2>', self.html)
        self.assertIn('<h2 id="soundLibraryHeading">Sound Library</h2>', self.html)
        self.assertIn("AI uploads occur only after explicit consent", self.html)
        self.assertIn("may re-encode lossy audio", self.html)
        self.assertNotIn("It does not yet extract the video soundtrack into editable tracks", self.html)

    def test_sound_library_candidates_can_be_explicitly_loaded_through_safe_track_import(self):
        self.assertIn("Load candidate into selected track", self.inline_script)
        self.assertIn("Target mix track for", self.inline_script)
        self.assertIn("new DataTransfer()", self.inline_script)
        self.assertIn("input.dispatchEvent(new Event('change',{bubbles:true}))", self.inline_script)
        self.assertIn("The current source will remain if the candidate fails validation.", self.inline_script)
        self.assertIn("SOUND_LIBRARY_CANDIDATE_SENT_TO_IMPORT", self.inline_script)
        self.assertIn("auto_mixed=false", self.inline_script)
        self.assertIn("not yet a confirmed mix placement", self.inline_script)

    def test_reviewed_ai_cue_can_set_track_offset_without_claiming_separate_clip_editing(self):
        self.assertIn("Set track offset to cue start", self.inline_script)
        self.assertIn("AI_CUE_START_APPLIED_TO_TRACK_OFFSET", self.inline_script)
        self.assertIn("separate_clip_timeline=false", self.inline_script)
        self.assertIn("not create a separate clip", self.inline_script)
        self.assertIn("outside the supported 0–3600 second track-offset range", self.inline_script)

    def test_ai_sound_plan_and_cue_proposals_are_exportable(self):
        self.assertIn('id="exportAIPlanJSON"', self.html)
        self.assertIn('id="exportAICuesCSV"', self.html)
        self.assertIn("OSD-AI-SOUND-PLAN", self.inline_script)
        self.assertIn("AI_SOUND_PLAN_EXPORTED", self.inline_script)
        self.assertIn("AI_SOUND_CUES_EXPORTED", self.inline_script)
        self.assertIn("'evidence_source','confidence','status'", self.inline_script)
        self.assertIn("'NOT_APPLIED'", self.inline_script)
        self.assertIn("AI proposals only; not applied to source media or mix", self.inline_script)
        self.assertIn("$('exportAIPlanJSON').disabled=true", self.inline_script)

    def test_dialogue_sidechain_music_ducking_is_optional_and_persisted(self):
        self.assertIn('id="duckDepth"', self.html)
        self.assertIn('id="duckThreshold"', self.html)
        self.assertIn("dialogueEnvelope", self.inline_script)
        self.assertIn("s.name==='music'?duckGain:1", self.inline_script)
        self.assertIn("duckDepthDb:Number($('duckDepth').value)", self.inline_script)
        self.assertIn("duckThresholdDb:Number($('duckThreshold').value)", self.inline_script)
        self.assertIn("const duckDepthDb=obj.master", self.inline_script)
        self.assertIn("const duckThresholdDb=obj.master", self.inline_script)
        self.assertIn("const PROJECT_VERSION=11", self.inline_script)
        self.assertIn("dialogueEnvelope=0;buf=new ArrayBuffer(output)", self.inline_script)
        self.assertIn("not speech recognition or an automatic mix-quality decision", self.html)

    def test_multi_clip_timeline_adds_clips_without_replacing_main_tracks(self):
        for element_id in ("multiClipSection", "extraClipTrack", "extraClipOffset",
                           "extraClipGain", "extraClipFadeIn", "extraClipFadeOut",
                           "extraClipFile", "extraClipList"):
            self.assertIn(f'id="{element_id}"', self.html)
        self.assertIn("const extraClips=[]", self.inline_script)
        self.assertIn("concat(extraClips.filter", self.inline_script)
        self.assertIn("TIMELINE_CLIP_ADDED", self.inline_script)
        self.assertIn("TIMELINE_CLIP_REMOVED", self.inline_script)
        self.assertIn("extraClips.reduce", self.inline_script)
        self.assertIn("if(!ts.length&&!extraClips.length)return null", self.inline_script)
        self.assertIn("(!ts.length&&!extraClips.length)||rendering", self.inline_script)
        self.assertIn("timelineClips:extraClips.map", self.inline_script)
        self.assertIn("mediaEmbedded:false", self.inline_script)
        self.assertIn("source_preserved=true", self.inline_script)
        self.assertIn("PROJECT_VERSION=11", self.inline_script)

    def test_per_track_noise_gate_is_reversible_and_off_by_default(self):
        self.assertIn("function dynamicsSettings(name)", self.inline_script)
        self.assertIn("gateThreshold:[-60,-20],gateReduction:[0,36]", self.inline_script)
        self.assertIn("s.maxGateReductionDb=dsp.gateReduction", self.inline_script)
        self.assertIn("if(dsp.gateReduction>0)", self.inline_script)
        self.assertIn("dsp.gateReduction===0", self.inline_script)
        self.assertIn("PROJECT_VERSION=11", self.inline_script)
        for track in ("dialogue", "music", "sfx", "ambience"):
            self.assertIn(f'id="gateThreshold-{track}"', self.html)
            self.assertIn(f'id="gateReduction-{track}"', self.html)
        self.assertIn("obj.projectVersion<11&&k==='gateReduction'?0:undefined", self.inline_script)
    def test_ai_service_connection_test_is_explicit_and_bounded(self):
        self.assertIn('id="testAIConnection"', self.html)
        self.assertIn('id="aiConnectionStatus"', self.html)
        self.assertIn("$('testAIConnection').addEventListener('click'", self.inline_script)
        self.assertIn("'/v1/health'", self.inline_script)
        self.assertIn("health check timed out after 8 seconds", self.inline_script)
        self.assertIn("Service reachable, but server secrets are not configured", self.inline_script)
        self.assertIn("A real provider analysis is still required to verify model access", self.inline_script)
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


    def test_autonomous_edit_draft_is_explicit_non_destructive_and_bounded(self):
        for element_id in ("autonomousEdit", "buildAutonomousEdit", "applyAutonomousEdit", "exportAutonomousEdit", "clearAutonomousEdit"):
            self.assertIn(f'id="{element_id}"', self.html)
        self.assertIn("OSD-AUTONOMOUS-EDIT-PACKAGE", self.inline_script)
        self.assertIn("DRAFT_NOT_EXECUTED", self.inline_script)
        self.assertIn("time range outside selected video", self.inline_script)
        self.assertIn("AUTONOMOUS_EDIT_CUES_STAGED", self.inline_script)
        self.assertIn("source_media_modified=false mix_settings_modified=false", self.inline_script)
        self.assertIn("method=local-frame-difference", self.inline_script)
        self.assertIn("scout_frames=\'+scoutCount", self.inline_script)

    def test_picture_edit_timeline_is_bounded_and_non_destructive(self):
        for element_id in ("pictureEditTimeline", "buildPictureTimeline", "splitPictureAtPlayhead", "resetPictureTimeline", "exportPictureEdits", "cancelPictureEditExport"):
            self.assertIn(f'id="{element_id}"', self.html)
        self.assertIn("PICTURE_TIMELINE_BUILT", self.inline_script)
        self.assertIn("PICTURE_INTERVAL_REMOVED", self.inline_script)
        self.assertIn("matching_audio_slices=true", self.inline_script)
        self.assertIn("partial_output_discarded=true", self.inline_script)
        self.assertIn("500*MiB", self.inline_script)
        self.assertIn("job.audioStream?.getTracks().forEach(t=>t.stop())", self.inline_script)
        self.assertIn("source_unchanged=true", self.inline_script)

if __name__ == "__main__":
    unittest.main()
    def test_original_source_previews_are_separate_from_rendered_mix(self):
        for name in ("dialogue", "music", "sfx", "ambience"):
            self.assertIn(f'id="original-preview-{name}"', self.html)
            self.assertIn(f'id="player-{name}" controls preload="metadata"', self.html)
        self.assertIn("Original audio — unchanged source", self.html)
        self.assertIn("Edited audio — rendered mix", self.html)
        self.assertIn('$(`original-preview-${name}`).hidden=false;', self.inline_script)
        self.assertIn('id="mixPlayer" controls', self.html)
        self.assertIn("source files are not overwritten", self.html)

