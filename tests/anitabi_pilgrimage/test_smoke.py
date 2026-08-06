import contextlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


REPO = Path(__file__).resolve().parents[2]
PACKAGE = REPO / "skills" / "anitabi-pilgrimage"
SCRIPTS = PACKAGE / "scripts"
sys.path.insert(0, str(SCRIPTS))


def load_script(name):
    spec = importlib.util.spec_from_file_location(f"anitabi_test_{name}", SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AnitabiSkillSmokeTests(unittest.TestCase):
    def test_package_contract_and_unique_library_ids(self):
        skill_text = (PACKAGE / "SKILL.md").read_text(encoding="utf-8")
        self.assertTrue((PACKAGE / "agents" / "openai.yaml").is_file())
        for forbidden in (".claude\\skills", "cc-connect", "Administrator", "reki-visual-lab"):
            self.assertNotIn(forbidden.lower(), skill_text.lower())
        works = json.loads((PACKAGE / "works_library.json").read_text(encoding="utf-8"))["works"]
        ids = [work["id"] for work in works]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertTrue((SCRIPTS / "vision_preflight.py").is_file())
        self.assertIn("multimodal", skill_text.lower())
        self.assertIn("vision_preflight.py", skill_text)
        self.assertIn("--vision-mode native", skill_text)
        self.assertIn("--vision-mode mmx", skill_text)

    def test_point_delivery_is_map_link_then_image_one_point_at_a_time(self):
        skill_text = (PACKAGE / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("固定逐点交付顺序", skill_text)
        self.assertIn("一个点一个点", skill_text)
        map_marker = skill_text.find("Google 地图链接")
        image_marker = skill_text.find("对应图片")
        self.assertGreaterEqual(map_marker, 0)
        self.assertGreaterEqual(image_marker, 0)
        self.assertLess(map_marker, image_marker)
        self.assertIn("不要先集中发送全部地图链接", skill_text)
        self.assertIn("不要把图片单独集中发送", skill_text)

    def test_native_preflight_does_not_need_mmx(self):
        preflight = load_script("vision_preflight")
        with patch.object(preflight, "find_mmx", side_effect=AssertionError("native must skip mmx")):
            result = preflight.check_mode("native")
        self.assertTrue(result["ready"])
        self.assertFalse(result["requires_mmx"])

    def test_non_multimodal_preflight_requires_mmx(self):
        preflight = load_script("vision_preflight")
        with patch.object(preflight, "find_mmx", return_value=None):
            result = preflight.check_mode("mmx")
        self.assertFalse(result["ready"])
        self.assertTrue(result["requires_mmx"])

    def test_missing_configured_mmx_path_is_blocked(self):
        preflight = load_script("vision_preflight")
        with patch.dict(os.environ, {"ANITABI_MMX_COMMAND": r"F:\missing\mmx.exe"}), \
             patch.object(preflight.shutil, "which", return_value=None):
            self.assertIsNone(preflight.find_mmx())

    def test_query_json_mode_is_stdout_only(self):
        query = load_script("anitabi_query")
        fake_lite = {"id": 123, "cn": "测试作品", "pointsLength": 1, "imagesLength": 1, "litePoints": []}
        output = io.StringIO()
        with patch.object(query, "get_lite", return_value=fake_lite), \
             patch.object(query, "search_bangumi", return_value=[]), \
             patch.object(sys, "argv", ["anitabi_query.py", "--id", "123", "--json"]), \
             contextlib.redirect_stdout(output):
            self.assertEqual(query.main(), 0)
        self.assertEqual(json.loads(output.getvalue())["id"], 123)

    def test_nearby_json_mode_returns_matching_point(self):
        nearby = load_script("anitabi_nearby")
        output = io.StringIO()
        points = [{"id": "p1", "name": "测试点", "geo": [35.69, 139.70]}]
        with patch.object(nearby, "get_all_points", return_value=points), \
             patch.object(nearby, "search_bangumi", return_value=[(123, "测试作品", "Test")]), \
             patch.object(sys, "argv", ["anitabi_nearby.py", "测试作品", "--area", "东京", "--json"]), \
             contextlib.redirect_stdout(output):
            self.assertEqual(nearby.main(), 0)
        payload = json.loads(output.getvalue())
        self.assertEqual(payload["subject"]["id"], 123)
        self.assertEqual(payload["nearby"][0]["id"], "p1")

    def test_reverse_json_reports_meter_distance_and_api_errors(self):
        reverse = load_script("anitabi_reverse")
        output = io.StringIO()

        def fake_points(subject_id):
            if subject_id == 2:
                return None, "fixture failure"
            return [{"name": "近点", "geo": [35.0001, 139.0001]}], None

        with patch.object(reverse, "load_library", return_value=[
            {"id": 1, "name": "A", "name_cn": "甲"},
            {"id": 2, "name": "B", "name_cn": "乙"},
        ]), \
             patch.object(reverse, "get_points", side_effect=fake_points), \
             patch.object(sys, "argv", ["anitabi_reverse.py", "--lat", "35", "--lng", "139", "--radius", "20", "--sleep", "0", "--json"]), \
             contextlib.redirect_stdout(output):
            self.assertEqual(reverse.main(), 0)
        payload = json.loads(output.getvalue())
        self.assertEqual(payload["found"][0]["work_id"], 1)
        self.assertEqual(payload["api_errors"][0]["work_id"], 2)

    def test_character_manifest_preserves_unknown_and_merges_boolean_labels(self):
        scan = load_script("scan_characters")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            images = root / "images"
            images.mkdir()
            (images / "01-point.jpg").write_bytes(b"fixture")
            points = root / "points.json"
            points.write_text(json.dumps([{"id": "point", "name": "测试点"}], ensure_ascii=False), encoding="utf-8")
            self.assertEqual(scan.build_manifest(images, points, labels=None)[0]["has_char"], None)
            self.assertEqual(scan.build_manifest(images, points, labels={"01-point.jpg": False})[0]["has_char"], False)

    def test_native_scan_never_calls_mmx(self):
        scan = load_script("scan_characters")
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            images = root / "images"
            images.mkdir()
            (images / "01-point.jpg").write_bytes(b"fixture")
            points = root / "points.json"
            points.write_text(json.dumps([{"id": "point", "name": "测试点"}], ensure_ascii=False), encoding="utf-8")
            with patch.object(scan, "classify_image_with_mmx", side_effect=AssertionError("native must skip mmx")), \
                 patch.object(sys, "argv", ["scan_characters.py", "--vision-mode", "native", "--images-dir", str(images), "--points-file", str(points), "--json"]), \
                 contextlib.redirect_stdout(output):
                self.assertEqual(scan.main(), 0)
        self.assertIsNone(json.loads(output.getvalue())[0]["has_char"])

    def test_mmx_scan_invokes_mmx_after_preflight(self):
        scan = load_script("scan_characters")
        output = io.StringIO()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            images = root / "images"
            images.mkdir()
            (images / "01-point.jpg").write_bytes(b"fixture")
            points = root / "points.json"
            points.write_text(json.dumps([{"id": "point", "name": "测试点"}], ensure_ascii=False), encoding="utf-8")
            ready = {"ready": True, "mode": "mmx", "requires_mmx": True, "command": "fake-mmx"}
            with patch.object(scan, "check_mode", return_value=ready), \
                 patch.object(scan, "classify_image_with_mmx", return_value=True) as classify, \
                 patch.object(sys, "argv", ["scan_characters.py", "--vision-mode", "mmx", "--images-dir", str(images), "--points-file", str(points), "--json"]), \
                 contextlib.redirect_stdout(output):
                self.assertEqual(scan.main(), 0)
        classify.assert_called_once()
        self.assertTrue(json.loads(output.getvalue())[0]["has_char"])


if __name__ == "__main__":
    unittest.main()
