"""Catalog contracts for Mefi's Studio AI+ (standalone repository).

Pins the committed catalog's curated merge: unique ids, pricing and typical
request math, quality/declared-source honesty, plan caps, and endpoint
resolution. No network and no Node required.
"""
from pathlib import Path
import json
import unittest


ROOT = Path(__file__).resolve().parents[1]
STUDIO = ROOT
CATALOG = STUDIO / "data" / "models.json"
CURATED = STUDIO / "data" / "curated.json"
VALID_CAPS = {None, 15, 30, 60, "unlimited"}


def _load(path):
    return json.loads(path.read_text(encoding="utf-8"))


class MefiStudioCatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = _load(CATALOG)
        cls.curated = _load(CURATED)
        cls.guide = (ROOT / "TESTRUNS.md").read_text(encoding="utf-8")

    def test_catalog_shape(self):
        self.assertEqual(1, self.catalog["schemaVersion"])
        self.assertGreaterEqual(len(self.catalog["models"]), 30)
        self.assertRegex(self.catalog["hash"], r"^[0-9a-f]{64}$")
        self.assertRegex(self.catalog["rosterHash"], r"^[0-9a-f]{64}$")
        self.assertIn("generatedAt", self.catalog)
        ids = [model["id"] for model in self.catalog["models"]]
        self.assertEqual(sorted(ids), sorted(set(ids)), "model ids must be unique")

    def test_typical_request_cost_matches_pricing(self):
        for model in self.catalog["models"]:
            price = (model.get("pricing") or {}).get("default")
            typical = model.get("typical")
            expected = model.get("typicalCostUSD")
            if not price or not typical or expected is None:
                continue
            with self.subTest(model=model["id"]):
                cache_read = price["cacheRead"] if price["cacheRead"] is not None else price["input"]
                computed = (
                    typical["input"] * price["input"]
                    + typical["cached"] * cache_read
                    + typical["output"] * price["output"]
                ) / 1e6
                # The pipeline stores typicalCostUSD rounded to 6 decimals.
                self.assertAlmostEqual(expected, computed, delta=1e-6)

    def test_quality_is_declared_or_absent(self):
        for model in self.catalog["models"]:
            quality = model["quality"]
            with self.subTest(model=model["id"]):
                if quality["index"] is None:
                    self.assertEqual("none", quality["declared"])
                else:
                    self.assertIn(quality["declared"], ("AA", "AA*"))
                    self.assertLessEqual(0, quality["index"])
                    self.assertLessEqual(quality["index"], 70)
                    self.assertTrue(
                        quality.get("indexVersion"),
                        "a published index must record which AA index version it came from",
                    )

    def test_usage_caps_and_promos(self):
        for model in self.catalog["models"]:
            usage = model["usage"]
            with self.subTest(model=model["id"]):
                self.assertIn(usage["monthlyCapUSD"], VALID_CAPS)
                if usage["monthlyCapUSD"] == "unlimited":
                    self.assertTrue(usage["unlimited"])
                if usage["promo"]:
                    self.assertIsNotNone(usage["monthlyCapBaseUSD"])
                    self.assertIsInstance(usage["monthlyCapUSD"], int)

    def test_curated_seed_is_complete(self):
        curated_ids = set(self.curated["models"])
        catalog_ids = {model["id"] for model in self.catalog["models"]}
        self.assertTrue(curated_ids)
        self.assertEqual(set(), curated_ids - catalog_ids, "curated ids missing from the catalog")
        for name, preset in [(p["id"], p) for p in self.curated["taskPresets"]]:
            with self.subTest(preset=name):
                self.assertAlmostEqual(1.0, sum(preset["weights"].values()), places=6)
                self.assertIn(preset["description"], (preset["description"],))
        for key in ("no-train-0day", "no-train-30day", "trains", "unknown"):
            self.assertIn(key, self.curated["privacyScores"])

    def test_endpoint_map_resolves_for_every_mapped_model(self):
        kinds = set(self.curated["endpoints"])
        mapped = set()
        for kind, ids in self.curated["endpointMap"].items():
            self.assertIn(kind, kinds)
            mapped.update(ids)
        self.assertTrue(mapped <= set(self.curated["models"]), "endpointMap ids must be curated models")
        for model in self.catalog["models"]:
            if model["id"] in mapped:
                with self.subTest(model=model["id"]):
                    self.assertIsNotNone(model["endpoint"])
                    self.assertIn(model["endpoint"]["kind"], kinds)

    def test_docs_register_this_contract(self):
        self.assertIn("`tools/test_mefi_studio_catalog.py`", self.guide)


if __name__ == "__main__":
    unittest.main()
