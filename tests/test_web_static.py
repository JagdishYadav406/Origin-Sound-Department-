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
        self.assertIn("async function validateWebmExportBlob(blob,expectedDuration)", self.inline_script)
        self.assertIn("timed out validating exported WebM metadata", self.inline_script)
        self.assertIn("for(const event of ['loadedmetadata','loadeddata','resize','canplay'])probe.addEventListener(event,check)", self.inline_script)
        self.assertIn("containerSignature:'UNKNOWN'", self.inline_script)
        self.assertIn("avSync:'NOT_MEASURED'", self.inline_script)
        self.assertIn("downloadCompletion:'UNVERIFIABLE'", self.inline_script)
        self.assertIn("VIDEO_MIX_EXPORT_QC status=PASS", self.inline_script)
        self.assertIn("No download was offered; source media unchanged.", self.inline_script)
        self.assertIn("const PROJECT_VERSION=13", self.inline_script)
        self.assertIn("dialogueEnvelope=0;buf=new ArrayBuffer(output)", self.inline_script)
        self.assertIn("not speech recognition or an automatic mix-quality decision", self.html)

    def test_autonomous_edit_drafts_are_invalidated_when_source_or_analysis_changes(self):
        self.assertIn("autonomousEditDraftContext=null", self.inline_script)
        self.assertIn("function autonomousEditDraftIsCurrent()", self.inline_script)
        self.assertIn("c.videoFile===videoFile&&c.analysis===aiLastResult&&c.mode===aiLastMode", self.inline_script)
        self.assertIn("alignmentConfirmed&&!!$('aiTimelineAligned').checked", self.inline_script)
        self.assertIn("if(!autonomousEditDraftIsCurrent())", self.inline_script)
        self.assertIn("Draft is stale: source, analysis, mode, or audio alignment changed", self.inline_script)
        self.assertIn("function captureAutonomousToolState()", self.inline_script)
        self.assertIn("autonomousToolStateMatches(c.toolState)", self.inline_script)
        self.assertIn("every mix control, loaded track source, extra clip, and local sound-library index", self.html)
        self.assertIn("limitSkipped", self.inline_script)
        self.assertIn("Source video, audio tracks and mix settings are unchanged.", self.inline_script)

    def test_autonomous_edit_plan_stages_reviewable_picture_boundaries_without_removing_footage(self):
        self.assertIn('id="stageAutonomousPicturePlan"', self.html)
        self.assertIn("pictureEditPlan:{method:'AI scene-boundary staging; not a semantic cut decision'", self.inline_script)
        self.assertIn("defaultAction:'KEEP_ALL_SOURCE_INTERVALS'", self.inline_script)
        self.assertIn("executed:false", self.inline_script)
        self.assertIn("function buildPictureTimeline()", self.inline_script)
        self.assertIn("const boundaries=autonomousEditDraft.pictureEditPlan.proposedBoundariesSeconds", self.inline_script)
        self.assertIn("proposed interval is shorter than 120 ms", self.inline_script)
        self.assertIn("Prepare all OSD tool workspaces", self.html)
        self.assertIn("autonomousEditDraft.toolCoverage", self.inline_script)
        self.assertIn("range collapses after clamping to video duration", self.inline_script)
        self.assertIn("recommendedTrack", self.inline_script)
        self.assertIn("all_source_intervals_retained=true source_media_modified=false", self.inline_script)
        self.assertIn("All source intervals remain included", self.html)

    def test_autonomous_tool_coverage_lists_all_production_workspaces(self):
        for tool in ("media-separation", "dialogue-refinement", "video-study",
                     "extra-timeline-clips", "ai-service-controls", "ai-plan-exports",
                     "source-integrity", "picture-edit", "dialogue", "music", "sfx",
                     "ambience", "sound-library", "mix-qc", "video-export",
                     "project-evidence"):
            self.assertIn("id:'" + tool + "'", self.inline_script)
        self.assertIn("Prepare all OSD tool workspaces", self.html)
        self.assertIn("autonomousEditDraft.toolCoverage", self.inline_script)
        self.assertIn("processing_settings_changed=false source_media_modified=false", self.inline_script)

    def test_ambiguous_autonomous_cues_are_not_auto_routed(self):
        self.assertIn("function recommendTrackForCategory(category)", self.inline_script)
        self.assertIn("'manual-review'", self.inline_script)
        self.assertIn("Choose track manually — category unclear", self.inline_script)
        self.assertIn("No automatic track assignment", self.inline_script)
        self.assertIn("Safe preparation partially completed", self.inline_script)
        self.assertIn("candidate row(s)", self.inline_script)

    def test_autonomous_track_evidence_scans_decoded_buffers_without_processing(self):
        self.assertIn('id="analyzeAutonomousTracks"', self.html)
        self.assertIn('id="cancelAutonomousTrackAnalysis"', self.html)
        self.assertIn("async function runAutonomousTrackEvidence()", self.inline_script)
        self.assertIn("for(let block=start;block<end;block+=131072)", self.inline_script)
        self.assertIn("source_upload=false processing_settings_changed=false", self.inline_script)
        self.assertIn("sample peak is not true peak", self.inline_script)
        self.assertIn("autonomousTrackEvidenceRevision", self.inline_script)
        self.assertIn("trackEvidence:autonomousTrackEvidenceIsCurrent()", self.inline_script)
        self.assertIn("No current local sample-level scan exists", self.inline_script)
        self.assertIn("Track evidence is stale because a source file changed", self.inline_script)
        self.assertIn("sourceFingerprintStatus", self.inline_script)
        self.assertIn("report.windowSeconds.toFixed(2)", self.inline_script)

    def test_autonomous_draft_requires_fresh_signal_evidence_when_tracks_are_loaded(self):
        self.assertIn("trackEvidenceReady=!loadedTracks||autonomousTrackEvidenceIsCurrent()", self.inline_script)
        self.assertIn("Run a fresh local sample scan of the loaded tracks before building a precision-focused draft", self.inline_script)

    def test_autonomous_workflow_runner_gates_render_export_and_evidence(self):
        self.assertIn('id="continueAutonomousWorkflow"', self.html)
        self.assertIn('id="autonomousTrackReviewConfirmed"', self.html)
        self.assertIn('id="autonomousMixPreviewReviewed"', self.html)
        self.assertIn('id="autonomousFinalExportApproved"', self.html)
        self.assertIn('id="autonomousOutputPlaybackReviewed"', self.html)
        self.assertIn("function continueAutonomousWorkflow()", self.inline_script)
        self.assertIn("autonomousWorkflowPreparedDraft!==autonomousEditDraft", self.inline_script)
        self.assertIn("QC gate blocked export", self.inline_script)
        self.assertIn("Output validation is still pending", self.inline_script)
        self.assertIn("PROJECT_SAVE_FAILED", self.inline_script)
        self.assertIn("EVIDENCE_REPORT_PREPARED", self.inline_script)
        self.assertIn("download receipt is not independently verified", self.inline_script)
        self.assertIn("autonomousWorkflowFinalApprovalContext", self.inline_script)
        self.assertIn("approval.segmentsKey!==segmentsKey", self.inline_script)
        self.assertIn("Final-export approval expired because the mix or picture timeline changed", self.inline_script)
        self.assertIn("current render passed PCM-structure checks", self.inline_script)
        self.assertIn("project JSON and QC evidence report prepared", self.inline_script)
        self.assertIn("autonomousWorkflowPackageExportedFor=null;autonomousWorkflowProjectSaveFor=null;autonomousWorkflowReportPreparedFor=null", self.inline_script)
        self.assertLess(self.inline_script.index("if(!autonomousWorkflowReportPreparedFor"), self.inline_script.index("if(autonomousWorkflowPackageExportedFor"))

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
        self.assertIn("PROJECT_VERSION=13", self.inline_script)

    def test_per_track_noise_gate_is_reversible_and_off_by_default(self):
        self.assertIn("function dynamicsSettings(name)", self.inline_script)
        self.assertIn("gateThreshold:[-60,-20],gateReduction:[0,36]", self.inline_script)
        self.assertIn("s.maxGateReductionDb=dsp.gateReduction", self.inline_script)
        self.assertIn("if(dsp.gateReduction>0)", self.inline_script)
        self.assertIn("dsp.gateReduction===0", self.inline_script)
        self.assertIn("PROJECT_VERSION=13", self.inline_script)
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
        self.assertIn("const PROJECT_VERSION=13", self.inline_script)
        self.assertIn("OSD-CHUNKED-SHA256-V1", self.inline_script)
        self.assertIn("fingerprintMatches&&metadataCompatible", self.inline_script)
        self.assertIn("PICTURE_TIMELINE_RESTORE_BLOCKED source_identity_mismatch=true", self.inline_script)
        self.assertIn("videoContentFingerprint(file,token)", self.inline_script)

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
        self.assertIn("sceneInput.slice(0,500)", self.inline_script)
        self.assertIn("cueInput.slice(0,500)", self.inline_script)
        self.assertIn("malformed scene item", self.inline_script)
        self.assertIn("malformed cue item", self.inline_script)
        self.assertIn("sampledFrameTimesSeconds:Array.isArray(aiLastResult.sampledFrameTimesSeconds)?aiLastResult.sampledFrameTimesSeconds.slice(0,500)", self.inline_script)
        self.assertIn("scout_frames=\'+scoutCount", self.inline_script)

    def test_picture_edit_timeline_is_bounded_and_non_destructive(self):
        for element_id in ("pictureEditTimeline", "buildPictureTimeline", "splitPictureAtPlayhead", "resetPictureTimeline", "undoPictureEdit", "exportPictureEdits", "cancelPictureEditExport"):
            self.assertIn(f'id="{element_id}"', self.html)
        self.assertIn("PICTURE_TIMELINE_BUILT", self.inline_script)
        self.assertIn("PICTURE_INTERVAL_REMOVED", self.inline_script)
        self.assertIn("PICTURE_TIMELINE_UNDO", self.inline_script)
        self.assertIn("picturePreviewEnd!==null", self.inline_script)
        self.assertIn("Remove picture interval", self.inline_script)
        self.assertIn("matching_audio_slices=true", self.inline_script)
        self.assertIn("edgeFadeSamples", self.inline_script)
        self.assertIn("browser seek delays can introduce sync drift", self.html)
        self.assertIn("partial_output_discarded=true", self.inline_script)
        self.assertIn("500*MiB", self.inline_script)
        self.assertIn("job.audioStream?.getTracks().forEach(t=>t.stop())", self.inline_script)
        self.assertIn("source_unchanged=true", self.inline_script)
        self.assertIn("PICTURE_EDIT_EXPORT_QC status=PASS", self.inline_script)
        self.assertIn("validateWebmExportBlob(blob,totalFrames/sr)", self.inline_script)
        self.assertIn("Picture export rejected by QC", self.inline_script)
        self.assertIn('id="multiClipWorkspace"', self.html)
        self.assertIn('id="mixMasterWorkspace"', self.html)
        self.assertIn('id="projectWorkspace"', self.html)
        self.assertIn('id="evidenceWorkspace"', self.html)
        self.assertIn("pictureTimeline:{source:", self.inline_script)
        self.assertIn("PICTURE_TIMELINE_RESTORED", self.inline_script)
        self.assertIn("PICTURE_TIMELINE_RESTORE_BLOCKED", self.inline_script)
        self.assertIn("importedPicture.segments.length>200", self.inline_script)
        self.assertIn("Picture intervals must be sorted and non-overlapping", self.inline_script)


    def test_tool_navigation_targets_exist_and_video_outputs_are_separate(self):
        nav = re.search(r'<nav class="feature-nav"[^>]*>(.*?)</nav>', self.html, re.S)
        self.assertIsNotNone(nav)
        targets = re.findall(r'href="#([^"]+)"', nav.group(1))
        ids = set(re.findall(r'\bid=["\']([^"\']+)["\']', self.html))
        self.assertTrue(targets)
        self.assertTrue(set(targets).issubset(ids), "broken feature navigation: " + repr(sorted(set(targets) - ids)))
        self.assertIn('id="sourceSection"', self.html)
        self.assertIn('<section class="panel" id="pictureEditWorkspace"', self.html)
        self.assertIn('id="editedVideoPlayer"', self.html)
        self.assertIn('id="editedVideoState"', self.html)
        self.assertIn("function showEditedVideoOutput(blob,label)", self.inline_script)
        self.assertIn("showEditedVideoOutput(blob,'Edited video + current mix')", self.inline_script)
        self.assertIn("showEditedVideoOutput(blob,'Edited picture timeline')", self.inline_script)
        self.assertIn("source_unchanged=true", self.inline_script)

    def test_ai_service_setup_points_to_existing_deployment_files_and_discloses_prerequisites(self):
        self.assertIn('id="aiServiceSetup"', self.html)
        self.assertIn('https://render.com/', self.html)
        self.assertIn('/tree/feature/separate-media-tool-workspaces/ai-service', self.html)
        self.assertIn("OPENAI_API_KEY", self.html)
        self.assertIn("OSD_SERVICE_TOKEN", self.html)
        self.assertIn("No media is sent to the connected service until you press its Analyze button", self.html)


    def test_no_credit_local_video_analysis_is_explicit_and_does_not_upload(self):
        self.assertIn('id="runLocalVideoAnalysis"', self.html)
        self.assertIn("$('runLocalVideoAnalysis').addEventListener('click',async()=>{", self.inline_script)
        self.assertIn("LOCAL_VIDEO_HEURISTIC_COMPLETE", self.inline_script)
        self.assertIn("no media uploaded", self.inline_script.lower())
        self.assertIn("no AI model", self.inline_script)
        self.assertIn("local-frame-difference", self.inline_script)

    def test_audio_classifier_releases_decoded_buffer_before_model_load(self):
        handler = self.inline_script.index("$('runLocalAudioModel').addEventListener('click',async()=>{")
        decode = self.inline_script.index("await context.decodeAudioData", handler)
        release = self.inline_script.index("decoded=null", decode)
        load_model = self.inline_script.index("const classifier=await getFreeAudioClassifier()", handler)
        self.assertLess(decode, release)
        self.assertLess(release, load_model)
        self.assertIn("const durationSeconds=decoded.duration", self.inline_script)
        self.assertIn("await context.close();context=null", self.inline_script)
        self.assertIn("durationSeconds,sampledFrameTimesSeconds:[]", self.inline_script)

    def test_audio_classifier_validates_duration_before_loading_model(self):
        handler = self.inline_script.index("$('runLocalAudioModel').addEventListener('click',async()=>{")
        decode = self.inline_script.index("await context.decodeAudioData", handler)
        duration_guard = self.inline_script.index("decoded.duration>90", decode)
        load_model = self.inline_script.index("const classifier=await getFreeAudioClassifier()", handler)
        self.assertLess(decode, duration_guard)
        self.assertLess(duration_guard, load_model)
        self.assertIn("segment=padded", self.inline_script)
        self.assertIn("new Float32Array(chunkSamples)", self.inline_script)

    def test_short_final_audio_classifier_segment_is_padded_for_model_input(self):
        self.assertIn("let segment=mono.slice(start,end)", self.inline_script)
        self.assertIn("segment=padded", self.inline_script)
        self.assertNotIn("segment.set(padded.subarray(0,segment.length))", self.inline_script)

    def test_free_local_audio_event_classifier_is_separate_and_no_upload(self):
        self.assertIn('id="runLocalAudioModel"', self.html)
        self.assertIn("$('runLocalAudioModel').addEventListener('click',async()=>{", self.inline_script)
        self.assertIn("@huggingface/transformers@3.8.1", self.inline_script)
        self.assertIn("ast-finetuned-audioset-10-10-0.4593-ONNX", self.inline_script)
        self.assertIn("dtype:'q4'", self.inline_script)
        self.assertIn("LOCAL_AUDIOSET_CLASSIFICATION_COMPLETE", self.inline_script)
        self.assertIn("upload=false paid_api=false", self.inline_script)
        self.assertIn("audio samples are decoded and classified in this browser", self.inline_script.lower())
        self.assertIn("PRETRAINED AUDIO CLASSIFIER · REVIEW LABELS", self.inline_script)

    def test_free_pretrained_visual_classifier_runs_locally_without_paid_api(self):
        self.assertIn('id="runLocalVisualModel"', self.html)
        self.assertIn("$('runLocalVisualModel').addEventListener('click',async()=>{", self.inline_script)
        self.assertIn("getFreeMobileNet()", self.inline_script)
        self.assertIn("mobileNet.load({version:2,alpha:0.5})", self.inline_script)
        self.assertIn("model.classify(canvas,3)", self.inline_script)
        self.assertIn("LOCAL_MOBILENET_ANALYSIS_COMPLETE", self.inline_script)
        self.assertIn("upload=false paid_api=false", self.inline_script)
        self.assertIn("pretrained image classifier", self.inline_script.lower())
        self.assertIn("Video frames are classified inside this browser and are not uploaded", self.inline_script)

    def test_no_credit_local_audio_analysis_uses_browser_signal_processing(self):
        self.assertIn('id="runLocalAudioAnalysis"', self.html)
        self.assertIn("$('runLocalAudioAnalysis').addEventListener('click',async()=>{", self.inline_script)
        self.assertIn("decodeAudioData", self.inline_script)
        self.assertIn("LOCAL_AUDIO_HEURISTIC_COMPLETE", self.inline_script)
        self.assertIn("No upload, account, AI model, or credits used.", self.inline_script)
        self.assertIn("MEASURED / HEURISTIC RESULT · NOT SEMANTIC AI", self.inline_script)

    def test_paid_connected_ai_is_optional_and_separate_from_local_mode(self):
        self.assertIn("Connected generative AI requires a separately configured provider and may cost money.", self.html)
        self.assertIn("For a zero-credit path, use the local analysis buttons below", self.html)
        self.assertIn("runLocalVideoAnalysis", self.html)
        self.assertIn("runLocalAudioAnalysis", self.html)

    def test_original_source_previews_are_separate_from_rendered_mix(self):
        for name in ("dialogue", "music", "sfx", "ambience"):
            self.assertIn(f'id="original-preview-{name}"', self.html)
            self.assertIn(f'id="player-{name}" controls preload="metadata"', self.html)
        self.assertIn("Original audio — unchanged source", self.html)
        self.assertIn("Edited audio — rendered mix", self.html)
        self.assertIn('$(`original-preview-${name}`).hidden=false;', self.inline_script)
        self.assertIn('id="mixPlayer" controls', self.html)
        self.assertIn("source files are not overwritten", self.html)

if __name__ == "__main__":
    unittest.main()
