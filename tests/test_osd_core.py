import sys
import unittest
from pathlib import Path
from unittest.mock import patch, Mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "app" / "src" / "main" / "python"))

from osd import core


class TruePeakTests(unittest.TestCase):
    @patch.object(core, "_android_bridge", return_value=None)
    @patch.object(core.subprocess, "run")
    def test_true_peak_uses_true_peak_not_sample_peak(self, run, _bridge):
        run.return_value = Mock(returncode=0, stderr=(
            "Peak: -2.4 dBFS\n"
            "True peak: -0.7 dBFS\n"
            "Peak: -1.8 dBFS\n"
            "True peak: -0.4 dBFS\n"
        ), stdout="")
        self.assertAlmostEqual(core.true_peak("output.wav"), -0.4)

    @patch.object(core, "_android_bridge", return_value=None)
    @patch.object(core.subprocess, "run")
    def test_missing_true_peak_stays_unknown(self, run, _bridge):
        run.return_value = Mock(returncode=0, stderr="Peak: -0.2 dBFS\n", stdout="")
        self.assertIsNone(core.true_peak("output.wav"))

    @patch.object(core, "_android_bridge", return_value=None)
    @patch.object(core.subprocess, "run")
    def test_ffmpeg_failure_is_not_reported_as_a_measurement(self, run, _bridge):
        run.return_value = Mock(returncode=1, stderr="decoder failed", stdout="")
        with self.assertRaises(core.OSDRunError):
            core.true_peak("output.wav")


    @patch.object(core, "_android_bridge", return_value=None)
    @patch.object(core.subprocess, "run")
    def test_true_peak_parses_multiline_ffmpeg_summary_without_sample_peak(self, run, _bridge):
        run.return_value = Mock(returncode=0, stderr=(
            "Sample peak:\n"
            "  Peak:      -0.2 dBFS\n"
            "True peak:\n"
            "  Peak:      -1.4 dBFS\n"
        ), stdout="")
        self.assertAlmostEqual(core.true_peak("output.wav"), -1.4)

    @patch.object(core, "_android_bridge", return_value=None)
    @patch.object(core.subprocess, "run")
    def test_true_peak_parses_inline_summary(self, run, _bridge):
        run.return_value = Mock(returncode=0, stderr="True peak: -0.8 dBFS\n", stdout="")
        self.assertAlmostEqual(core.true_peak("output.wav"), -0.8)


class ChannelMapTests(unittest.TestCase):
    def test_stereo_channel_map_is_deterministic(self):
        self.assertEqual(core._channel_map("stereo", 2), ["FL", "FR"])

    def test_mismatched_channel_map_is_unknown(self):
        self.assertIsNone(core._channel_map("stereo", 1))


if __name__ == "__main__":
    unittest.main()


class DeliveryGateTests(unittest.TestCase):
    def valid_report(self):
        return {
            "verification": {"status": "VERIFIED"},
            "delivery_status": "DELIVERABLE",
            "qc": {"checks": {"all_pass": True}},
            "checks": {"source_unchanged": True, "artifacts_integrity_verified": True},
            "source_integrity": {"unchanged": True},
        }

    def test_verified_qc_passed_report_is_allowed(self):
        core._assert_delivery_verified(self.valid_report())

    def test_unverified_report_is_blocked_even_if_qc_enforcement_is_disabled(self):
        report = self.valid_report()
        report["verification"]["status"] = "UNVERIFIED"
        report["delivery_status"] = "BLOCKED"
        with self.assertRaisesRegex(core.OSDRunError, "not DELIVERABLE|not VERIFIED"):
            core._assert_delivery_verified(report)

    def test_missing_qc_measurements_cannot_be_deliverable(self):
        report = self.valid_report()
        report["qc"]["checks"]["all_pass"] = False
        with self.assertRaisesRegex(core.OSDRunError, "QC"):
            core._assert_delivery_verified(report)

    def test_changed_source_blocks_delivery(self):
        report = self.valid_report()
        report["source_integrity"]["unchanged"] = False
        with self.assertRaisesRegex(core.OSDRunError, "source preservation"):
            core._assert_delivery_verified(report)

    def test_stale_ready_marker_is_removed_when_clearing_delivery_markers(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            ready = Path(tmp) / "DELIVERY-READY.txt"
            blocked = Path(tmp) / "DELIVERY-BLOCKED.txt"
            ready.write_text("stale ready")
            blocked.write_text("stale blocked")
            core._clear_delivery_markers(tmp)
            self.assertFalse(ready.exists())
            self.assertFalse(blocked.exists())

