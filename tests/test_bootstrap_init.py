from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.main import normalize_bootstrap_wrapper_argv
from infra.sqlite.bootstrap import bootstrap_init


class BootstrapInitTests(unittest.TestCase):
    def _make_project(self, root: Path) -> None:
        (root / "migrations").mkdir(parents=True, exist_ok=True)
        (root / "templates").mkdir(parents=True, exist_ok=True)
        (root / "contracts").mkdir(parents=True, exist_ok=True)
        (root / "migrations" / "0001_initial.sql").write_text(
            (Path(__file__).resolve().parents[1] / "migrations" / "0001_initial.sql").read_text(encoding="utf-8"),
            encoding="utf-8",
        )
        (root / "templates" / "template_registry.seed.json").write_text(
            json.dumps([
                {
                    "template_id": "dsp-default",
                    "template_version": "v1",
                    "workflow": "dsp",
                    "mapping_version": "v1",
                    "is_active": 1,
                    "meta_json": {},
                }
            ], ensure_ascii=False),
            encoding="utf-8",
        )
        (root / "templates" / "ruleset.seed.json").write_text(
            json.dumps([
                {
                    "rule_version": "v1",
                    "rule_hash": "h1",
                    "meta_json": {},
                }
            ], ensure_ascii=False),
            encoding="utf-8",
        )
        (root / "bootstrap.manifest.json").write_text(
            json.dumps(
                {
                    "project_id": "test",
                    "env": "dev",
                    "db": {"path": "data/mdrep.sqlite"},
                    "schema": {"target_version": "0001"},
                    "template_registry": {"seed": "templates/template_registry.seed.json"},
                    "rule_registry": {"seed": "templates/ruleset.seed.json"},
                    "feature_flags": {},
                    "artifact_root": "artifacts",
                    "runlog_policy": {"require_checksums": True},
                    "created_at": "2026-05-07T00:00:00+08:00",
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

    def test_bootstrap_init_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._make_project(root)

            first = bootstrap_init(root)
            second = bootstrap_init(root)

            self.assertEqual(first["status"], "ok")
            self.assertEqual(second["status"], "ok")
            self.assertEqual(first["audit_log_status"], "ok")
            self.assertEqual(second["audit_log_status"], "ok")
            self.assertEqual(first["feature_flags"]["strict_acceptance_gate"], False)
            self.assertEqual(first["acceptance_gate"]["enabled"], False)
            self.assertEqual(first["acceptance_gate"]["status"], "skipped")
            db_path = Path(first["db_path"])
            self.assertTrue(db_path.exists())

            conn = sqlite3.connect(str(db_path))
            try:
                migration_count = conn.execute("SELECT COUNT(1) FROM schema_migrations WHERE version='0001'").fetchone()[0]
                self.assertEqual(migration_count, 1)

                template_count = conn.execute("SELECT COUNT(1) FROM template_registry").fetchone()[0]
                self.assertGreaterEqual(template_count, 1)

                binding_count = conn.execute("SELECT COUNT(1) FROM rule_bindings").fetchone()[0]
                self.assertGreaterEqual(binding_count, 1)
            finally:
                conn.close()

    def test_bootstrap_audit_failure_is_soft_fail(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._make_project(root)

            with patch("infra.sqlite.bootstrap.append_audit_event", side_effect=RuntimeError("audit down")):
                out = bootstrap_init(root)

            self.assertEqual(out["status"], "ok")
            self.assertEqual(out["audit_log_status"], "soft_failed")

            conn = sqlite3.connect(str(Path(out["db_path"])))
            try:
                migration_count = conn.execute("SELECT COUNT(1) FROM schema_migrations WHERE version='0001'").fetchone()[0]
                template_count = conn.execute("SELECT COUNT(1) FROM template_registry WHERE is_active=1").fetchone()[0]
                rule_count = conn.execute("SELECT COUNT(1) FROM ruleset_versions").fetchone()[0]
                binding_count = conn.execute("SELECT COUNT(1) FROM rule_bindings").fetchone()[0]
                audit_count = conn.execute("SELECT COUNT(1) FROM audit_log WHERE event_type='bootstrap_init'").fetchone()[0]
                self.assertEqual(migration_count, 1)
                self.assertGreaterEqual(template_count, 1)
                self.assertGreaterEqual(rule_count, 1)
                self.assertGreaterEqual(binding_count, 1)
                self.assertEqual(audit_count, 0)
            finally:
                conn.close()

    def test_wrapper_argv_normalization(self) -> None:
        self.assertEqual(
            normalize_bootstrap_wrapper_argv(["--root", ".", "--manifest", "bootstrap.manifest.json"]),
            ["--root", ".", "--manifest", "bootstrap.manifest.json", "bootstrap"],
        )
        self.assertEqual(
            normalize_bootstrap_wrapper_argv(["--root", ".", "health"]),
            ["--root", ".", "health"],
        )
        self.assertEqual(
            normalize_bootstrap_wrapper_argv(["--root", "bootstrap", "--manifest", "x.json"]),
            ["--root", "bootstrap", "--manifest", "x.json", "bootstrap"],
        )

    def test_bootstrap_init_reads_feature_flags(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self._make_project(root)
            manifest_path = root / "bootstrap.manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["feature_flags"] = {
                "enable_test_hooks": True,
                "enable_trace_markers": True,
                "strict_acceptance_gate": True,
            }
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")

            out = bootstrap_init(root)
            self.assertEqual(out["status"], "ok")
            self.assertEqual(out["feature_flags"]["enable_test_hooks"], True)
            self.assertEqual(out["feature_flags"]["enable_trace_markers"], True)
            self.assertEqual(out["feature_flags"]["strict_acceptance_gate"], True)
            self.assertEqual(out["acceptance_gate"]["enabled"], True)
            self.assertEqual(out["acceptance_gate"]["status"], "ok")


if __name__ == "__main__":
    unittest.main()
