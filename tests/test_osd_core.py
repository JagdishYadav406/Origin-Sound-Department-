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
