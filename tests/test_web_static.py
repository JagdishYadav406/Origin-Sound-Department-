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
        self.assertIn("OSD-WEB-QC-EVIDENCE", self.inline_script)

if __name__ == "__main__":
    unittest.main()
