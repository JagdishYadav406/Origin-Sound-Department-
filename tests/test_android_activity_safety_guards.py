import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ACTIVITY = ROOT / "app/src/main/java/com/origin/osd/MainActivity.java"


class AndroidActivitySafetyGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = ACTIVITY.read_text(encoding="utf-8")

    def test_each_processing_path_uses_a_unique_output_directory(self):
        self.assertEqual(self.source.count("File output = createRunOutputDirectory();"), 2)
        self.assertIn('new File(base, "run-" + runId)', self.source)
        self.assertIn("java.util.UUID.randomUUID()", self.source)

    def test_new_runs_do_not_delete_previous_final_deliverables(self):
        self.assertNotIn('deleteIfExists(new File(output, "OSD-final.wav"))', self.source)
        self.assertNotIn('deleteIfExists(new File(output, "OSD-final.webm"))', self.source)
        self.assertNotIn('deleteIfExists(new File(output, "evidence.json"))', self.source)

    def test_import_compares_provider_size_when_available(self):
        self.assertIn("long expectedSourceBytes = displaySize(uri);", self.source)
        self.assertIn("expectedSourceBytes >= 0 && importedBytes != expectedSourceBytes", self.source)
        self.assertIn("input.length() != importedBytes", self.source)
        self.assertIn("sha256(input).equalsIgnoreCase(importedHash.toString())", self.source)


if __name__ == "__main__":
    unittest.main()
