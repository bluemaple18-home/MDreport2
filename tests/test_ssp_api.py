from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import shutil
import subprocess
import unittest
from unittest.mock import patch

from infra.ssp_api import (
    DEFAULT_AUTH_DECRYPT_KEY,
    SspApiClient,
    SspAuthError,
    SspApiSettings,
    SspScopeCheckAuth,
    normalize_ssp_report_rows,
    resolve_ssp_api_settings,
)


class _MockHttpResponse:
    def __init__(self, payload: bytes) -> None:
        self._payload = payload

    def read(self) -> bytes:
        return self._payload

    def __enter__(self) -> _MockHttpResponse:
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


def _encrypt_scope_check_payload(payload: dict[str, object], *, key_b64: str = DEFAULT_AUTH_DECRYPT_KEY) -> str:
    plaintext = json.dumps(payload, ensure_ascii=False)
    serialized = f's:{len(plaintext.encode("utf-8"))}:"{plaintext}";'.encode("utf-8")
    key_bytes = base64.b64decode(key_b64)
    iv_bytes = bytes.fromhex("00112233445566778899aabbccddeeff")
    proc = subprocess.run(
        [
            "openssl",
            "enc",
            "-e",
            "-aes-256-cbc",
            "-K",
            key_bytes.hex(),
            "-iv",
            iv_bytes.hex(),
        ],
        input=serialized,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode("utf-8", errors="replace"))
    iv_b64 = base64.b64encode(iv_bytes).decode("utf-8")
    value_b64 = base64.b64encode(proc.stdout).decode("utf-8")
    mac = hmac.new(key_bytes, f"{iv_b64}{value_b64}".encode("utf-8"), hashlib.sha256).hexdigest()
    outer = {"iv": iv_b64, "value": value_b64, "mac": mac}
    return base64.b64encode(json.dumps(outer, ensure_ascii=False).encode("utf-8")).decode("utf-8")


def _build_scope_check_envelope(cipher_bytes: bytes = b"cipher", *, key_b64: str = DEFAULT_AUTH_DECRYPT_KEY) -> str:
    key_bytes = base64.b64decode(key_b64)
    iv_bytes = bytes.fromhex("00112233445566778899aabbccddeeff")
    iv_b64 = base64.b64encode(iv_bytes).decode("utf-8")
    value_b64 = base64.b64encode(cipher_bytes).decode("utf-8")
    mac = hmac.new(key_bytes, f"{iv_b64}{value_b64}".encode("utf-8"), hashlib.sha256).hexdigest()
    outer = {"iv": iv_b64, "value": value_b64, "mac": mac}
    return base64.b64encode(json.dumps(outer, ensure_ascii=False).encode("utf-8")).decode("utf-8")


class SspApiTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("openssl"), "openssl required for roundtrip fixture")
    def test_scope_check_auth_decrypts_payload_and_selects_ssp_service_token(self) -> None:
        encrypted = _encrypt_scope_check_payload(
            {
                "user": {"id": 2072, "email": "matt@clickforce.com.tw"},
                "services": [
                    {"service_id": 1, "token": "dsp-token"},
                    {"service_id": 14, "token": "ssp-token-14", "supplier_id": 0, "is_house": 0},
                ],
                "max_age": "57600",
            }
        )
        settings = SspApiSettings(
            email="matt@clickforce.com.tw",
            password="24450379",
        )

        with patch("infra.ssp_api.urlopen", return_value=_MockHttpResponse(json.dumps(encrypted).encode("utf-8"))):
            auth = SspScopeCheckAuth(settings).authenticate()

        self.assertEqual(int(auth["service_id"]), 14)
        self.assertEqual(str(auth["token"]), "ssp-token-14")
        self.assertEqual(int((auth["user"] or {}).get("id") or 0), 2072)
        self.assertEqual(str(auth["max_age"]), "57600")

    def test_scope_check_auth_reports_missing_openssl_binary(self) -> None:
        encrypted = _build_scope_check_envelope()
        settings = SspApiSettings(email="matt@clickforce.com.tw", password="24450379")

        with self.assertRaises(SspAuthError) as exc_ctx:
            with (
                patch("infra.ssp_api.shutil.which", return_value=None),
                patch("infra.ssp_api.subprocess.run") as mock_run,
            ):
                SspScopeCheckAuth(settings)._decrypt_scope_check_payload(encrypted)

        self.assertIn("找不到 openssl binary", str(exc_ctx.exception))
        mock_run.assert_not_called()

    def test_scope_check_auth_reports_openssl_runtime_failure(self) -> None:
        encrypted = _build_scope_check_envelope()
        settings = SspApiSettings(email="matt@clickforce.com.tw", password="24450379")

        with self.assertRaises(SspAuthError) as exc_ctx:
            with (
                patch("infra.ssp_api.shutil.which", return_value="/usr/bin/openssl"),
                patch(
                    "infra.ssp_api.subprocess.run",
                    return_value=subprocess.CompletedProcess(
                        args=["/usr/bin/openssl"],
                        returncode=1,
                        stdout=b"",
                        stderr=b"bad decrypt",
                    ),
                ),
            ):
                SspScopeCheckAuth(settings)._decrypt_scope_check_payload(encrypted)

        self.assertIn("scope-check openssl 解密失敗: bad decrypt", str(exc_ctx.exception))

    def test_resolve_ssp_api_settings_requires_supported_credential_sources(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            with patch("infra.ssp_api._load_legacy_api_config_credentials", return_value={}):
                with self.assertRaises(SspAuthError) as exc_ctx:
                    resolve_ssp_api_settings()
        self.assertIn("缺少 SSP 正規登入帳密", str(exc_ctx.exception))

    def test_resolve_ssp_api_settings_accepts_env_aliases_without_legacy_config_file(self) -> None:
        with (
            patch.dict(
                "os.environ",
                {
                    "MDREPORT_API_EMAIL": "legacy-alias@clickforce.com.tw",
                    "MDREPORT_API_PASSWORD": "legacy-alias-pass",
                },
                clear=True,
            ),
            patch("infra.ssp_api._load_legacy_api_config_credentials", return_value={}),
        ):
            settings = resolve_ssp_api_settings()
        self.assertEqual(settings.email, "legacy-alias@clickforce.com.tw")
        self.assertEqual(settings.password, "legacy-alias-pass")

    def test_resolve_ssp_api_settings_accepts_legacy_config_credentials(self) -> None:
        with (
            patch.dict("os.environ", {}, clear=True),
            patch(
                "infra.ssp_api._load_legacy_api_config_credentials",
                return_value={"email": "config@clickforce.com.tw", "password": "config-pass"},
            ),
        ):
            settings = resolve_ssp_api_settings()
        self.assertEqual(settings.email, "config@clickforce.com.tw")
        self.assertEqual(settings.password, "config-pass")

    def test_normalize_ssp_report_rows_maps_contract_to_ssp_raw_columns(self) -> None:
        rows = normalize_ssp_report_rows(
            [
                {
                    "data_time": "2026-05-11 03:00:00",
                    "zone_id": "10230",
                    "zoneName": "DEMO LINK 專用",
                    "supplier_id": "1",
                    "supplierName": "域動測試",
                    "site_id": "784",
                    "siteName": "DEMO link",
                    "request": "2885",
                    "impress": "1386",
                    "click": "3",
                    "profit": "2.08",
                    "advertiser_mu": "8.32",
                }
            ],
            source_name="ssp3_api",
        )

        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["source"], "ssp3_api")
        self.assertEqual(row["ts"], "2026-05-11 03:00:00")
        self.assertEqual(row["date"], "2026-05-11")
        self.assertEqual(int(row["hour"]), 3)
        self.assertEqual(int(row["placement_id"]), 10230)
        self.assertEqual(str(row["placement_name"]), "DEMO LINK 專用")
        self.assertEqual(float(row["request"]), 2885.0)
        self.assertEqual(float(row["impression"]), 1386.0)
        self.assertEqual(float(row["clicks"]), 3.0)
        self.assertEqual(float(row["revenue"]), 2.08)
        self.assertEqual(float(row["dsp_amount"]), 8.32)

    def test_fetch_report_bundle_aggregates_multi_day_range_as_daily_chunks(self) -> None:
        client = SspApiClient(SspApiSettings(email="matt@clickforce.com.tw", password="24450379"))

        with (
            patch.object(client._auth, "authenticate", return_value={"service_id": 14, "token": "ssp-token-14", "user": {"id": 2072}}),
            patch.object(client, "get_login_info", return_value={"id": 2072, "email": "matt@clickforce.com.tw"}) as mock_login,
            patch.object(
                client,
                "create_report_condition",
                side_effect=[
                    {"data": {"id": 101}},
                    {"data": {"id": 102}},
                ],
            ) as mock_create,
            patch.object(
                client,
                "get_report_result",
                side_effect=[
                    {
                        "code": "200",
                        "data": {
                            "recordsTotal": 2,
                            "sumRow": {
                                "request": 10,
                                "impress": 100,
                                "click": 10,
                                "ctr": 10.0,
                                "profit": "25",
                                "ecpm": 250.0,
                                "advertiser_mu": "50",
                                "dsp_ecpm": 500.0,
                            },
                            "data": [
                                {"data_time": "2026-05-10 00:00:00"},
                                {"data_time": "2026-05-10 01:00:00"},
                            ],
                        },
                    },
                    {
                        "code": "200",
                        "data": {
                            "recordsTotal": 1,
                            "sumRow": {
                                "request": 20,
                                "impress": 200,
                                "click": 10,
                                "ctr": 5.0,
                                "profit": "25",
                                "ecpm": 125.0,
                                "advertiser_mu": "75",
                                "dsp_ecpm": 375.0,
                            },
                            "data": [
                                {"data_time": "2026-05-11 00:00:00"},
                            ],
                        },
                    },
                ],
            ) as mock_result,
            patch("infra.ssp_api.time.sleep", return_value=None) as mock_sleep,
        ):
            bundle = client.fetch_report_bundle(start_day="2026-05-10", end_day="2026-05-11")

        self.assertEqual(int(bundle["records_total"]), 3)
        self.assertEqual(int(bundle["report_id"]), 102)
        self.assertEqual(list(bundle["report_ids"]), [101, 102])
        self.assertEqual(
            list(bundle["daily"]),
            [
                {"date": "2026-05-10", "report_id": 101, "row_count": 2, "records_total": 2},
                {"date": "2026-05-11", "report_id": 102, "row_count": 1, "records_total": 1},
            ],
        )
        self.assertEqual(str(bundle["chunk_mode"]), "daily")
        self.assertEqual(int(bundle["chunk_days"]), 2)
        self.assertEqual(len(bundle["rows"]), 3)
        self.assertEqual(int(bundle["sum_row"]["request"]), 30)
        self.assertEqual(int(bundle["sum_row"]["impress"]), 300)
        self.assertEqual(int(bundle["sum_row"]["click"]), 20)
        self.assertAlmostEqual(float(bundle["sum_row"]["profit"]), 50.0)
        self.assertAlmostEqual(float(bundle["sum_row"]["advertiser_mu"]), 125.0)
        self.assertAlmostEqual(float(bundle["sum_row"]["ctr"]), 6.666667)
        self.assertAlmostEqual(float(bundle["sum_row"]["ecpm"]), 166.666667)
        self.assertAlmostEqual(float(bundle["sum_row"]["dsp_ecpm"]), 416.666667)
        mock_login.assert_called_once_with("ssp-token-14")
        self.assertEqual(mock_create.call_count, 2)
        mock_create.assert_any_call("ssp-token-14", start_day="2026-05-10", end_day="2026-05-10")
        mock_create.assert_any_call("ssp-token-14", start_day="2026-05-11", end_day="2026-05-11")
        self.assertEqual(mock_result.call_count, 2)
        mock_sleep.assert_called_once()
