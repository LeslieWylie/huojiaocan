"""Validate the correctness of PageIndex data files against the actual PDF.

The PDF physical page is the primary key.  Section boundaries come from the
actual table of contents and the PDF header/footer printed page numbers.
"""
from __future__ import annotations

import json
import os
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DEMO_INDEX = ROOT / "demo" / "data" / "index"
RUNTIME = ROOT / "services" / "pageindex-service" / "runtime"
SEED_RUNTIME = ROOT / "services" / "pageindex-service" / "seed-runtime"
DEMO_MATERIALS = ROOT / "demo" / "public" / "materials"

OLD_FILENAME = "九年级语文上册-教师用书.pdf"
CORRECT_FILENAME = "九年级语文上册-教师教学用书.pdf"
TEXTBOOK_FILENAME = "九年级语文上册-学生教材.pdf"


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


class TeacherGuidePageAssertions(unittest.TestCase):
    """Verify the teacher-guide index data matches the actual PDF content."""

    @classmethod
    def setUpClass(cls):
        cls.pages = load_json(DEMO_INDEX / "teacher-guide-pages.json")
        cls.tree = load_json(DEMO_INDEX / "teacher-guide-tree.json")
        cls.runtime_index = load_json(RUNTIME / "indexes" / "teacher-guide.json")

    def _page_by_physical(self, physical: int) -> dict:
        for p in self.pages:
            if p["pageNumber"] == physical:
                return p
        raise KeyError(f"physical page {physical} not found")

    def test_physical_64_is_xiangchou_printed_48(self):
        """Assert teacher-guide 64=乡愁/印刷48."""
        page = self._page_by_physical(64)
        self.assertEqual(page["title"], "4 乡愁")
        self.assertEqual(page["printedPage"], "48")

    def test_physical_72_is_april_printed_56(self):
        """Assert teacher-guide 72=你是人间的四月天/印刷56."""
        page = self._page_by_physical(72)
        self.assertEqual(page["title"], "5 你是人间的四月天")
        self.assertEqual(page["printedPage"], "56")

    def test_physical_81_is_i_see_printed_65(self):
        """Assert teacher-guide 81=我看/印刷65."""
        page = self._page_by_physical(81)
        self.assertEqual(page["title"], "6 我看")
        self.assertEqual(page["printedPage"], "65")

    def test_xiangchou_page_range(self):
        """4 乡愁 spans physical pages 62-71 (printed 46-55)."""
        for p in self.pages:
            if p["pageNumber"] == 62:
                self.assertEqual(p["title"], "4 乡愁")
                self.assertEqual(p["printedPage"], "46")
            if p["pageNumber"] == 71:
                self.assertEqual(p["title"], "4 乡愁")
                self.assertEqual(p["printedPage"], "55")

    def test_april_page_range(self):
        """5 你是人间的四月天 spans physical pages 72-80 (printed 56-64)."""
        for p in self.pages:
            if p["pageNumber"] == 72:
                self.assertEqual(p["title"], "5 你是人间的四月天")
                self.assertEqual(p["printedPage"], "56")
            if p["pageNumber"] == 80:
                self.assertEqual(p["title"], "5 你是人间的四月天")
                self.assertEqual(p["printedPage"], "64")

    def test_i_see_page_range(self):
        """6 我看 starts at physical page 81 (printed 65)."""
        page = self._page_by_physical(81)
        self.assertEqual(page["title"], "6 我看")
        self.assertEqual(page["printedPage"], "65")

    def test_tree_xiangchou_range(self):
        """Tree has 4 乡愁 at physical 62-71."""
        u1 = self.tree[0]
        for child in u1["children"]:
            if "4 乡愁" in child["title"]:
                self.assertEqual(child["startPage"], 62)
                self.assertEqual(child["endPage"], 71)
                return
        self.fail("4 乡愁 not found in tree")

    def test_tree_april_range(self):
        """Tree has 5 你是人间的四月天 at physical 72-80."""
        u1 = self.tree[0]
        for child in u1["children"]:
            if "5 你是人间的四月天" in child["title"]:
                self.assertEqual(child["startPage"], 72)
                self.assertEqual(child["endPage"], 80)
                return
        self.fail("5 你是人间的四月天 not found in tree")

    def test_tree_i_see_range(self):
        """Tree has 6 我看 at physical 81-90."""
        u1 = self.tree[0]
        for child in u1["children"]:
            if "6 我看" in child["title"]:
                self.assertEqual(child["startPage"], 81)
                self.assertEqual(child["endPage"], 90)
                return
        self.fail("6 我看 not found in tree")

    def test_runtime_index_printed_page(self):
        """Runtime index has correct printedPage values."""
        for p in self.runtime_index["pages"]:
            if p["pdfPageNumber"] == 64:
                self.assertEqual(p["printedPage"], "48")
                self.assertIn("乡愁", p["pageTitle"])
            if p["pdfPageNumber"] == 72:
                self.assertEqual(p["printedPage"], "56")
                self.assertIn("四月天", p["pageTitle"])
            if p["pdfPageNumber"] == 81:
                self.assertEqual(p["printedPage"], "65")
                self.assertIn("我看", p["pageTitle"])

    def test_printed_page_offset_consistency(self):
        """Main content printed pages increase by 1 per physical page, offset=16."""
        for p in self.pages:
            phys = p["pageNumber"]
            printed = p["printedPage"]
            if printed is not None and phys >= 17:
                expected = str(phys - 16)
                self.assertEqual(
                    printed, expected,
                    f"physical {phys} printed={printed} expected={expected}"
                )

    def test_no_missing_printed_pages_after_physical_17(self):
        """Every physical page >= 17 has a printed page number."""
        for p in self.pages:
            if p["pageNumber"] >= 17:
                self.assertIsNotNone(
                    p["printedPage"],
                    f"physical {p['pageNumber']} has no printedPage"
                )

    def test_search_candidates_do_not_overwrite_primary_keys(self):
        """Retrieval text in the runtime index does not overwrite physicalPage/title/pdfUrl."""
        seen = set()
        for p in self.runtime_index["pages"]:
            phys = p["pdfPageNumber"]
            title = p["pageTitle"]
            printed = p.get("printedPage")
            # Each page should have unique primary key combination
            key = (phys, title)
            self.assertNotIn(
                key, seen,
                f"Duplicate physicalPage+title at physical {phys}: {title}"
            )
            seen.add(key)
            # Physical page number must be preserved
            self.assertIsInstance(phys, int)
            self.assertGreaterEqual(phys, 1)
            # Page title must be present
            self.assertTrue(title, f"Empty title for physical page {phys}")
            # pdfUrl is stored in the document record, not in page text
            # The retrieval text should not contain the pdfUrl accidentally
            retrieval = p.get("retrievalText", "") or ""
            self.assertNotIn(
                "pdfUrl", retrieval,
                f"retrievalText for physical page {phys} should not contain pdfUrl"
            )
            # Verify sectionPath is a list
            self.assertIsInstance(p.get("sectionPath", []), list)


class TextbookPageAssertions(unittest.TestCase):
    """Verify the textbook index data matches the actual PDF content."""

    @classmethod
    def setUpClass(cls):
        cls.pages = load_json(DEMO_INDEX / "textbook-pages.json")
        cls.tree = load_json(DEMO_INDEX / "textbook-tree.json")

    def test_xiangchou_at_physical_15_printed_9(self):
        """4 乡愁 in textbook at physical 15, printed 9."""
        for p in self.pages:
            if p["pageNumber"] == 15:
                self.assertEqual(p["title"], "4 乡愁")
                self.assertEqual(p["printedPage"], "9")

    def test_april_at_physical_16_printed_10(self):
        """5 你是人间的四月天 in textbook at physical 16, printed 10."""
        for p in self.pages:
            if p["pageNumber"] == 16:
                self.assertEqual(p["title"], "5 你是人间的四月天")
                self.assertEqual(p["printedPage"], "10")

    def test_i_see_at_physical_18_printed_12(self):
        """6 我看 in textbook at physical 18, printed 12."""
        for p in self.pages:
            if p["pageNumber"] == 18:
                self.assertEqual(p["title"], "6 我看")
                self.assertEqual(p["printedPage"], "12")

    def test_textbook_offset_consistency(self):
        """Textbook offset is 6: printed = physical - 6 for main content."""
        for p in self.pages:
            phys = p["pageNumber"]
            printed = p["printedPage"]
            if printed is not None and phys >= 7:
                expected = str(phys - 6)
                self.assertEqual(
                    printed, expected,
                    f"physical {phys} printed={printed} expected={expected}"
                )


class RuntimeServiceValidation(unittest.TestCase):
    """Verify the runtime service data matches the demo index data."""

    @classmethod
    def setUpClass(cls):
        cls.demo_pages = load_json(DEMO_INDEX / "teacher-guide-pages.json")
        cls.runtime_index = load_json(RUNTIME / "indexes" / "teacher-guide.json")

    def test_runtime_page_count_matches_demo(self):
        """Runtime index has the same number of pages as the demo pages file."""
        self.assertEqual(len(self.runtime_index["pages"]), len(self.demo_pages))

    def test_runtime_printed_page_matches_demo(self):
        """Runtime index printedPage matches demo pages printedPage."""
        demo_by_phys = {p["pageNumber"]: p for p in self.demo_pages}
        for rp in self.runtime_index["pages"]:
            phys = rp["pdfPageNumber"]
            dp = demo_by_phys.get(phys)
            if dp:
                self.assertEqual(
                    rp.get("printedPage"),
                    dp.get("printedPage"),
                    f"physical {phys}: runtime printedPage mismatch"
                )


class PdfUrlConsistencyTest(unittest.TestCase):
    """Verify all PDF URL references use the canonical filename."""

    @classmethod
    def setUpClass(cls):
        cls.doc_teacher_guide = load_json(RUNTIME / "documents" / "teacher-guide.json")
        cls.seed_doc_teacher_guide = load_json(SEED_RUNTIME / "documents" / "teacher-guide.json")
        cls.runtime_validations = {
            "teacher-guide": load_json(RUNTIME / "validations" / "teacher-guide.json"),
            "textbook": load_json(RUNTIME / "validations" / "textbook.json"),
        }
        cls.seed_validations = {
            "teacher-guide": load_json(SEED_RUNTIME / "validations" / "teacher-guide.json"),
            "textbook": load_json(SEED_RUNTIME / "validations" / "textbook.json"),
        }
        cls.runtime_indexes = {
            "teacher-guide": load_json(RUNTIME / "indexes" / "teacher-guide.json"),
            "textbook": load_json(RUNTIME / "indexes" / "textbook.json"),
        }
        cls.seed_indexes = {
            "teacher-guide": load_json(SEED_RUNTIME / "indexes" / "teacher-guide.json"),
            "textbook": load_json(SEED_RUNTIME / "indexes" / "textbook.json"),
        }

    def test_teacher_guide_document_pdfUrl_is_correct(self):
        """Teacher-guide document pdfUrl must use the canonical filename."""
        self.assertEqual(
            self.doc_teacher_guide["pdfUrl"],
            f"/materials/{CORRECT_FILENAME}",
        )
        self.assertEqual(
            self.doc_teacher_guide["originalFilename"],
            CORRECT_FILENAME,
        )
        self.assertEqual(
            self.doc_teacher_guide["originalObjectKey"],
            f"materials/{CORRECT_FILENAME}",
        )

    def test_seed_teacher_guide_document_pdfUrl_is_correct(self):
        """Seed teacher-guide document pdfUrl must use the canonical filename."""
        self.assertEqual(
            self.seed_doc_teacher_guide["pdfUrl"],
            f"/materials/{CORRECT_FILENAME}",
        )
        self.assertEqual(
            self.seed_doc_teacher_guide["originalFilename"],
            CORRECT_FILENAME,
        )
        self.assertEqual(
            self.seed_doc_teacher_guide["originalObjectKey"],
            f"materials/{CORRECT_FILENAME}",
        )

    def _check_validation_hits_pdfUrl(self, validation, doc_id, label, expected_filename):
        """Check all viewer.pdfUrl hits in a validation result."""
        for question_block in validation.get("questions", []):
            for hit in question_block.get("hits", []):
                if hit.get("documentId") == doc_id:
                    viewer = hit.get("viewer", {})
                    pdf_url = viewer.get("pdfUrl", "")
                    self.assertIn(
                        expected_filename, pdf_url,
                        f"{label}: viewer.pdfUrl '{pdf_url}' does not contain expected filename '{expected_filename}'",
                    )

    def test_runtime_validation_hits_pdfUrl_teacher_guide(self):
        """All runtime validation hits for teacher-guide use correct pdfUrl."""
        self._check_validation_hits_pdfUrl(
            self.runtime_validations["teacher-guide"], "teacher-guide", "runtime teacher-guide", CORRECT_FILENAME
        )

    def test_seed_validation_hits_pdfUrl_teacher_guide(self):
        """All seed validation hits for teacher-guide use correct pdfUrl."""
        self._check_validation_hits_pdfUrl(
            self.seed_validations["teacher-guide"], "teacher-guide", "seed teacher-guide", CORRECT_FILENAME
        )

    def test_runtime_validation_hits_pdfUrl_textbook(self):
        """All runtime validation hits for textbook use correct pdfUrl."""
        self._check_validation_hits_pdfUrl(
            self.runtime_validations["textbook"], "textbook", "runtime textbook", TEXTBOOK_FILENAME
        )

    def test_seed_validation_hits_pdfUrl_textbook(self):
        """All seed validation hits for textbook use correct pdfUrl."""
        self._check_validation_hits_pdfUrl(
            self.seed_validations["textbook"], "textbook", "seed textbook", TEXTBOOK_FILENAME
        )

    def test_teacher_guide_pdf_file_exists(self):
        """The canonical teacher-guide PDF file must exist in demo/public/materials."""
        pdf_path = DEMO_MATERIALS / CORRECT_FILENAME
        self.assertTrue(
            pdf_path.is_file(),
            f"Canonical PDF file not found: {pdf_path}",
        )

    def test_old_filename_does_not_exist_in_materials(self):
        """The old filename must NOT exist in demo/public/materials."""
        old_path = DEMO_MATERIALS / OLD_FILENAME
        self.assertFalse(
            old_path.is_file(),
            f"Old filename still exists: {old_path}",
        )

    def test_no_old_filename_in_any_runtime_file(self):
        """Assert the old filename does not appear in any runtime JSON file."""
        for subdir in ["documents", "indexes", "validations"]:
            for f in sorted((RUNTIME / subdir).iterdir()):
                content = f.read_text(encoding="utf-8")
                self.assertNotIn(
                    OLD_FILENAME, content,
                    f"Old filename found in runtime/{subdir}/{f.name}",
                )

    def test_no_old_filename_in_any_seed_file(self):
        """Assert the old filename does not appear in any seed-runtime JSON file."""
        for subdir in ["documents", "indexes", "validations"]:
            for f in sorted((SEED_RUNTIME / subdir).iterdir()):
                content = f.read_text(encoding="utf-8")
                self.assertNotIn(
                    OLD_FILENAME, content,
                    f"Old filename found in seed-runtime/{subdir}/{f.name}",
                )


if __name__ == "__main__":
    unittest.main()