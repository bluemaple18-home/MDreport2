from __future__ import annotations

import base64
import hashlib
import hmac
import importlib.util
import json
import os
import re
import shutil
import subprocess
import time
import uuid
from datetime import date, timedelta
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from infra.dsp_rules import classify_dsp_row


DEFAULT_SCOPE_CHECK_URL = "https://cua3.holmesmind.com/api/login/scope-check"
DEFAULT_SSP_API_BASE_URL = "https://ssp3-api.holmesmind.com/api"
DEFAULT_AUTH_DECRYPT_KEY = "5ZzWd0cX4MeDVRtZNNDoN/WbXr+9jRETVUlD7PLHsEg="
DEFAULT_SSP_SERVICE_ID = 14
DEFAULT_SOURCE_NAME = "ssp3_api"
DEFAULT_TIMEOUT_SECONDS = 60
DEFAULT_RANGE_DAY_PAUSE_SECONDS = 1.0

SERIALIZED_STRING_RE = re.compile(r'^s:(\d+):"(.*)";$', re.DOTALL)

SSP_SUM_ROW_INT_FIELDS = (
    "request",
    "impress",
    "active_view",
    "click",
    "invalid_impress",
    "invalid_click",
)
SSP_SUM_ROW_FLOAT_FIELDS = (
    "profit",
    "site_mu",
    "advertiser_mu",
)

SSP_REPORT_DIMENSIONS = [
    {"id": "data_time", "name": "時間"},
    {"id": "supplier_id", "name": "供應商"},
    {"id": "site_id", "name": "網站"},
    {"id": "zone_id", "name": "版位"},
]

SSP_AD_GROUP_REPORT_DIMENSIONS = [
    {"id": "data_time", "name": "時間"},
    {"id": "zone_id", "name": "版位"},
]

SSP_MONTHLY_ZONE_CAMPAIGN_SIZE_DIMENSIONS = [
    {"id": "data_time", "name": "時間"},
    {"id": "zone_id", "name": "版位"},
    {"id": "campaign_id", "name": "訂單"},
    {"id": "creative_size_id", "name": "素材尺寸"},
]

SSP_MONTHLY_ZONE_SIZE_DIMENSIONS = [
    {"id": "data_time", "name": "時間"},
    {"id": "zone_id", "name": "版位"},
    {"id": "creative_size_id", "name": "素材尺寸"},
]

SSP_MONTHLY_COUNTRY_DIMENSIONS = [
    {"id": "data_time", "name": "時間"},
    {"id": "country", "name": "國家"},
]

SSP_REPORT_POINTERS = [
    {"id": "request", "name": "請求數"},
    {"id": "impress", "name": "曝光數"},
    {"id": "active_view", "name": "可視曝光數"},
    {"id": "active_view_rate", "name": "可視曝光率"},
    {"id": "click", "name": "點擊數"},
    {"id": "ctr", "name": "點擊率"},
    {"id": "ecpm", "name": "eCPM"},
    {"id": "ecpc", "name": "eCPC"},
    {"id": "invalid_impress", "name": "無效曝光數"},
    {"id": "invalid_click", "name": "無效點擊數"},
    {"id": "profit", "name": "網站收益"},
    {"id": "site_mu", "name": "拆分前金額"},
    {"id": "advertiser_mu", "name": "DSP-執行金額"},
    {"id": "dsp_ecpm", "name": "DSP-eCPM"},
    {"id": "dsp_ecpc", "name": "DSP-eCPC"},
]

SSP_MONTHLY_COUNTRY_POINTERS = [
    {"id": "request", "name": "請求數"},
    {"id": "impress", "name": "曝光數"},
]


class SspApiError(Exception):
    pass


class SspAuthError(SspApiError):
    pass


@dataclass(frozen=True)
class SspApiSettings:
    email: str
    password: str
    scope_check_url: str = DEFAULT_SCOPE_CHECK_URL
    api_base_url: str = DEFAULT_SSP_API_BASE_URL
    auth_decrypt_key: str = DEFAULT_AUTH_DECRYPT_KEY
    service_id: int = DEFAULT_SSP_SERVICE_ID
    source_name: str = DEFAULT_SOURCE_NAME
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS

    @property
    def get_login_url(self) -> str:
        return f"{self.api_base_url.rstrip('/')}/v1/get-login"

    @property
    def report_conditions_url(self) -> str:
        return f"{self.api_base_url.rstrip('/')}/v1/admin/report-conditions"

    def report_result_url(self, report_id: int) -> str:
        return f"{self.api_base_url.rstrip('/')}/v1/admin/report/{report_id}"


def _strip_text(value: object) -> str:
    return str(value or "").strip()


def _coerce_int(value: object) -> int:
    raw = _strip_text(value)
    if not raw:
        return 0
    try:
        return int(float(raw))
    except Exception:
        return 0


def _coerce_float(value: object) -> float:
    raw = _strip_text(value).replace(",", "")
    if not raw:
        return 0.0
    try:
        return float(raw)
    except Exception:
        return 0.0


def _round_metric(value: float) -> float:
    return round(float(value), 6)


def _safe_rate(numerator: float, denominator: float, *, scale: float) -> float:
    if denominator <= 0:
        return 0.0
    return _round_metric((numerator / denominator) * scale)


def _load_legacy_api_config_credentials() -> dict[str, str]:
    config_path = Path(os.getenv("MDREPORT_API_CONFIG_PATH") or "~/MDreport/config/api_config.py").expanduser()
    if not config_path.exists():
        return {}
    spec = importlib.util.spec_from_file_location("mdreport_legacy_api_config", config_path)
    if spec is None or spec.loader is None:
        return {}
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except Exception:
        return {}
    return {
        "email": _strip_text(getattr(module, "API_EMAIL", "")),
        "password": _strip_text(getattr(module, "API_PASSWORD", "")),
    }


def aggregate_ssp_sum_rows(sum_rows: list[dict[str, object]]) -> dict[str, object]:
    available_fields = {key for row in sum_rows for key in row.keys()}
    if not available_fields:
        return {}

    aggregate: dict[str, object] = {}
    for field in SSP_SUM_ROW_INT_FIELDS:
        if field in available_fields:
            aggregate[field] = sum(_coerce_int(row.get(field)) for row in sum_rows)
    for field in SSP_SUM_ROW_FLOAT_FIELDS:
        if field in available_fields:
            aggregate[field] = _round_metric(sum(_coerce_float(row.get(field)) for row in sum_rows))

    if "active_view_rate" in available_fields:
        aggregate["active_view_rate"] = _safe_rate(
            float(aggregate.get("active_view", 0)),
            float(aggregate.get("impress", 0)),
            scale=100.0,
        )
    if "ctr" in available_fields:
        aggregate["ctr"] = _safe_rate(
            float(aggregate.get("click", 0)),
            float(aggregate.get("impress", 0)),
            scale=100.0,
        )
    if "ecpm" in available_fields:
        aggregate["ecpm"] = _safe_rate(
            float(aggregate.get("profit", 0.0)),
            float(aggregate.get("impress", 0)),
            scale=1000.0,
        )
    if "ecpc" in available_fields:
        aggregate["ecpc"] = _safe_rate(
            float(aggregate.get("profit", 0.0)),
            float(aggregate.get("click", 0)),
            scale=1.0,
        )
    if "dsp_ecpm" in available_fields:
        aggregate["dsp_ecpm"] = _safe_rate(
            float(aggregate.get("advertiser_mu", 0.0)),
            float(aggregate.get("impress", 0)),
            scale=1000.0,
        )
    if "dsp_ecpc" in available_fields:
        aggregate["dsp_ecpc"] = _safe_rate(
            float(aggregate.get("advertiser_mu", 0.0)),
            float(aggregate.get("click", 0)),
            scale=1.0,
        )
    return aggregate


def resolve_ssp_api_settings(
    *,
    email: str | None = None,
    password: str | None = None,
    scope_check_url: str | None = None,
    api_base_url: str | None = None,
    auth_decrypt_key: str | None = None,
    service_id: int | None = None,
    source_name: str | None = None,
    timeout_seconds: int | None = None,
) -> SspApiSettings:
    legacy_config = _load_legacy_api_config_credentials()
    resolved_email = (
        _strip_text(email)
        or _strip_text(os.getenv("MDREP_SSP_EMAIL"))
        or _strip_text(os.getenv("MDREPORT_API_EMAIL"))
        or _strip_text(legacy_config.get("email"))
    )
    resolved_password = (
        _strip_text(password)
        or _strip_text(os.getenv("MDREP_SSP_PASSWORD"))
        or _strip_text(os.getenv("MDREPORT_API_PASSWORD"))
        or _strip_text(legacy_config.get("password"))
    )

    if not resolved_email or not resolved_password:
        raise SspAuthError(
            "缺少 SSP 正規登入帳密；請提供 --email/--password、設定 MDREP_SSP_EMAIL/MDREP_SSP_PASSWORD，"
            "設定 MDREPORT_API_EMAIL/MDREPORT_API_PASSWORD，或提供 ~/MDreport/config/api_config.py"
        )

    resolved_service_id = service_id if service_id is not None else _coerce_int(os.getenv("MDREP_SSP_SERVICE_ID")) or DEFAULT_SSP_SERVICE_ID
    resolved_timeout = timeout_seconds if timeout_seconds is not None else _coerce_int(os.getenv("MDREP_SSP_TIMEOUT")) or DEFAULT_TIMEOUT_SECONDS
    return SspApiSettings(
        email=resolved_email,
        password=resolved_password,
        scope_check_url=_strip_text(scope_check_url) or _strip_text(os.getenv("MDREP_SSP_SCOPE_CHECK_URL")) or DEFAULT_SCOPE_CHECK_URL,
        api_base_url=_strip_text(api_base_url) or _strip_text(os.getenv("MDREP_SSP_API_BASE_URL")) or DEFAULT_SSP_API_BASE_URL,
        auth_decrypt_key=_strip_text(auth_decrypt_key) or _strip_text(os.getenv("MDREP_SSP_AUTH_DECRYPT_KEY")) or DEFAULT_AUTH_DECRYPT_KEY,
        service_id=resolved_service_id,
        source_name=_strip_text(source_name) or _strip_text(os.getenv("MDREP_SSP_SOURCE_NAME")) or DEFAULT_SOURCE_NAME,
        timeout_seconds=resolved_timeout,
    )


def _encode_multipart_form(fields: dict[str, object]) -> tuple[bytes, str]:
    boundary = f"----MDREPBoundary{uuid.uuid4().hex}"
    parts: list[bytes] = []
    for key, value in fields.items():
        parts.extend(
            [
                f"--{boundary}".encode("utf-8"),
                f'Content-Disposition: form-data; name="{key}"'.encode("utf-8"),
                b"",
                _strip_text(value).encode("utf-8"),
            ]
        )
    parts.extend([f"--{boundary}--".encode("utf-8"), b""])
    return b"\r\n".join(parts), boundary


def build_ssp_report_condition_payload(
    *,
    start_day: str,
    end_day: str,
    report_time: str = "hourly",
    pb: int = 0,
    filters: list[dict[str, object]] | None = None,
    dimensions: list[dict[str, object]] | None = None,
    pointers: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    report_time_names = {"hourly": "時報", "daily": "日報", "monthly": "月報"}
    report_time_name = report_time_names.get(report_time, str(report_time))
    return {
        "reportTime": {"id": report_time, "name": report_time_name},
        "reportType": {"id": "regular", "name": "一般報表"},
        "mediatype": {"id": "generl", "name": "一般媒體"},
        "often_used": 0,
        "status": 0,
        "supplier_id": 0,
        "outside": {"id": 1, "name": "不含家外"},
        "pb": {"id": pb, "name": "不含墊檔" if pb else "包含墊檔"},
        "thirdParty": {"id": 0, "name": "包含第三方"},
        "customName": None,
        "startDay": start_day,
        "endDay": end_day,
        "filter": list(filters or []),
        "dimension": list(dimensions or SSP_REPORT_DIMENSIONS),
        "pointer": list(pointers or SSP_REPORT_POINTERS),
        "media_country": {"id": "ALL", "name": "所有媒體"},
        "campaign_country": {"id": "ALL", "name": "所有經銷商"},
    }


def build_ssp_ad_group_report_condition_payload(
    *,
    start_day: str,
    end_day: str,
    zone_group_id: int,
    zone_group_name: str = "",
) -> dict[str, object]:
    return build_ssp_report_condition_payload(
        start_day=start_day,
        end_day=end_day,
        report_time="daily",
        pb=1,
        filters=[
            {
                "name": "zone_group",
                "value": [{"id": int(zone_group_id), "name": zone_group_name or str(zone_group_id)}],
            }
        ],
        dimensions=SSP_AD_GROUP_REPORT_DIMENSIONS,
    )


def build_ssp_monthly_zone_campaign_size_report_condition_payload(
    *,
    start_day: str,
    end_day: str,
    pb: int = 1,
    dimensions: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    return build_ssp_report_condition_payload(
        start_day=start_day,
        end_day=end_day,
        report_time="monthly",
        pb=pb,
        dimensions=dimensions or SSP_MONTHLY_ZONE_CAMPAIGN_SIZE_DIMENSIONS,
    )


def build_ssp_monthly_country_report_condition_payload(
    *,
    start_day: str,
    end_day: str,
    pb: int = 0,
    zone_group_id: int | None = None,
) -> dict[str, object]:
    filters: list[dict[str, object]] = []
    if zone_group_id is not None and int(zone_group_id) > 0:
        filters.append({"name": "zone_group", "value": [{"id": int(zone_group_id), "name": str(int(zone_group_id))}]})
    return build_ssp_report_condition_payload(
        start_day=start_day,
        end_day=end_day,
        report_time="daily",
        pb=pb,
        filters=filters,
        dimensions=SSP_MONTHLY_COUNTRY_DIMENSIONS,
        pointers=SSP_MONTHLY_COUNTRY_POINTERS,
    )


def _parse_iso_date(value: str) -> date:
    try:
        return date.fromisoformat(_strip_text(value))
    except Exception as exc:
        raise SspApiError(f"invalid ISO date: {value}") from exc


class SspScopeCheckAuth:
    def __init__(self, settings: SspApiSettings) -> None:
        self.settings = settings

    def authenticate(self) -> dict[str, object]:
        raw_text = self._post_scope_check()
        encrypted = json.loads(raw_text)
        if not isinstance(encrypted, str) or not encrypted.strip():
            raise SspAuthError("scope-check 未回傳有效加密 payload")
        decrypted = self._decrypt_scope_check_payload(encrypted.strip())
        if not isinstance(decrypted, dict):
            raise SspAuthError("scope-check 解密後 payload 不是 object")
        services = decrypted.get("services")
        if not isinstance(services, list):
            raise SspAuthError("scope-check payload 缺少 services")
        selected = None
        for service in services:
            if not isinstance(service, dict):
                continue
            if _coerce_int(service.get("service_id")) == int(self.settings.service_id):
                selected = service
                break
        if selected is None:
            available = sorted(_coerce_int(item.get("service_id")) for item in services if isinstance(item, dict))
            raise SspAuthError(
                f"scope-check payload 不含目標 service_id={self.settings.service_id}；available={available}"
            )
        token = _strip_text(selected.get("token"))
        if not token:
            raise SspAuthError(f"scope-check service_id={self.settings.service_id} 缺少 token")
        user = decrypted.get("user") if isinstance(decrypted.get("user"), dict) else {}
        return {
            "service_id": int(self.settings.service_id),
            "token": token,
            "user": user,
            "max_age": _strip_text(decrypted.get("max_age")),
            "services": services,
        }

    def _post_scope_check(self) -> str:
        body, boundary = _encode_multipart_form(
            {
                "email": self.settings.email,
                "password": self.settings.password,
                "status": 1,
            }
        )
        return _request_text(
            self.settings.scope_check_url,
            method="POST",
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            body=body,
            timeout_seconds=self.settings.timeout_seconds,
        )

    def _decrypt_scope_check_payload(self, encrypted_payload: str) -> dict[str, object]:
        try:
            outer = json.loads(base64.b64decode(encrypted_payload))
        except Exception as exc:
            raise SspAuthError("scope-check 加密 payload 格式不合法") from exc
        if not isinstance(outer, dict):
            raise SspAuthError("scope-check 加密 payload 不是 object")

        iv_b64 = _strip_text(outer.get("iv"))
        value_b64 = _strip_text(outer.get("value"))
        mac = _strip_text(outer.get("mac")).lower()
        if not iv_b64 or not value_b64 or not mac:
            raise SspAuthError("scope-check 加密 payload 缺少 iv/value/mac")

        key_bytes = base64.b64decode(self.settings.auth_decrypt_key)
        expected_mac = hmac.new(
            key_bytes,
            f"{iv_b64}{value_b64}".encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(expected_mac, mac):
            raise SspAuthError("scope-check MAC 驗證失敗")

        try:
            iv_bytes = base64.b64decode(iv_b64)
            cipher_bytes = base64.b64decode(value_b64)
        except Exception as exc:
            raise SspAuthError("scope-check iv/value base64 解碼失敗") from exc

        openssl_path = shutil.which("openssl")
        if not openssl_path:
            raise SspAuthError("scope-check 解密需要 openssl，但系統找不到 openssl binary")
        try:
            proc = subprocess.run(
                [
                    openssl_path,
                    "enc",
                    "-d",
                    "-aes-256-cbc",
                    "-K",
                    key_bytes.hex(),
                    "-iv",
                    iv_bytes.hex(),
                ],
                input=cipher_bytes,
                capture_output=True,
                check=False,
            )
        except OSError as exc:
            raise SspAuthError(f"scope-check openssl 執行失敗: {exc}") from exc
        if proc.returncode != 0:
            stderr = proc.stderr.decode("utf-8", errors="replace").strip()
            raise SspAuthError(f"scope-check openssl 解密失敗: {stderr or 'unknown error'}")

        plaintext = proc.stdout.decode("utf-8", errors="strict")
        matched = SERIALIZED_STRING_RE.fullmatch(plaintext)
        if matched is None:
            raise SspAuthError("scope-check 解密後不是 PHP serialized string")
        inner = matched.group(2)
        declared_len = _coerce_int(matched.group(1))
        if declared_len and len(inner.encode("utf-8")) != declared_len:
            raise SspAuthError("scope-check serialized string 長度不符")
        try:
            payload = json.loads(inner)
        except Exception as exc:
            raise SspAuthError("scope-check 解密後 JSON 解析失敗") from exc
        if not isinstance(payload, dict):
            raise SspAuthError("scope-check 解密後 payload 不是 object")
        return payload


def _request_text(
    url: str,
    *,
    method: str,
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
    timeout_seconds: int,
) -> str:
    req = Request(url, data=body, method=method.upper())
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urlopen(req, timeout=timeout_seconds) as resp:
            return resp.read().decode("utf-8")
    except HTTPError as exc:
        body_text = exc.read().decode("utf-8", errors="replace")
        raise SspApiError(f"HTTP {exc.code} {method.upper()} {url}: {body_text}") from exc
    except URLError as exc:
        raise SspApiError(f"request failed {method.upper()} {url}: {exc}") from exc


def _request_json(
    url: str,
    *,
    method: str,
    headers: dict[str, str] | None = None,
    json_body: dict[str, object] | None = None,
    timeout_seconds: int,
) -> dict[str, object]:
    body = None
    merged_headers = {"Accept": "application/json"}
    merged_headers.update(headers or {})
    if json_body is not None:
        body = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
        merged_headers.setdefault("Content-Type", "application/json")
    raw = _request_text(
        url,
        method=method,
        headers=merged_headers,
        body=body,
        timeout_seconds=timeout_seconds,
    )
    try:
        payload = json.loads(raw)
    except Exception as exc:
        raise SspApiError(f"invalid json response from {url}") from exc
    if not isinstance(payload, dict):
        raise SspApiError(f"invalid response shape from {url}")
    return payload


class SspApiClient:
    def __init__(self, settings: SspApiSettings) -> None:
        self.settings = settings
        self._auth = SspScopeCheckAuth(settings)

    def fetch_report_bundle(self, *, start_day: str, end_day: str) -> dict[str, object]:
        auth = self._auth.authenticate()
        token = _strip_text(auth.get("token"))
        login_info = self.get_login_info(token)
        start_dt = _parse_iso_date(start_day)
        end_dt = _parse_iso_date(end_day)
        if start_dt > end_dt:
            raise SspApiError("start_day cannot be after end_day")

        report_condition = None
        report_result = None
        report_id = 0
        report_ids: list[int] = []
        daily: list[dict[str, object]] = []
        combined_rows: list[dict[str, object]] = []
        records_total = 0
        sum_rows: list[dict[str, object]] = []
        day_count = 0
        current = start_dt
        while current <= end_dt:
            current_day = current.isoformat()
            if day_count > 0:
                time.sleep(DEFAULT_RANGE_DAY_PAUSE_SECONDS)
            report_condition = self.create_report_condition(token, start_day=current_day, end_day=current_day)
            report_id = _coerce_int((report_condition.get("data") or {}).get("id"))
            if report_id <= 0:
                raise SspApiError(f"report-conditions 未回傳有效 id: {report_condition}")
            report_ids.append(report_id)
            report_result = self.get_report_result(token, report_id=report_id)
            data = report_result.get("data")
            if not isinstance(data, dict):
                raise SspApiError("report result 缺少 data object")
            rows = data.get("data")
            if not isinstance(rows, list):
                raise SspApiError("report result 缺少 data rows")
            day_rows = [row for row in rows if isinstance(row, dict)]
            day_records_total = _coerce_int(data.get("recordsTotal"))
            combined_rows.extend(day_rows)
            records_total += day_records_total
            daily.append(
                {
                    "date": current_day,
                    "report_id": report_id,
                    "row_count": len(day_rows),
                    "records_total": day_records_total,
                }
            )
            raw_sum_row = data.get("sumRow")
            if isinstance(raw_sum_row, dict):
                sum_rows.append(raw_sum_row)
            day_count += 1
            current += timedelta(days=1)

        if report_condition is None or report_result is None:
            raise SspApiError("fetch_report_bundle did not execute any daily report requests")
        return {
            "auth": auth,
            "login": login_info,
            "report_condition": report_condition,
            "report_id": report_id,
            "report_ids": report_ids,
            "daily": daily,
            "report_result": report_result,
            "rows": combined_rows,
            "records_total": records_total,
            "sum_row": aggregate_ssp_sum_rows(sum_rows),
            "chunk_mode": "daily" if day_count > 1 else "single",
            "chunk_days": day_count,
        }

    def fetch_ad_group_report_bundle(
        self,
        *,
        start_day: str,
        end_day: str,
        zone_group_id: int,
        zone_group_name: str = "",
    ) -> dict[str, object]:
        auth = self._auth.authenticate()
        token = _strip_text(auth.get("token"))
        login_info = self.get_login_info(token)
        start_dt = _parse_iso_date(start_day)
        end_dt = _parse_iso_date(end_day)
        if start_dt > end_dt:
            raise SspApiError("start_day cannot be after end_day")
        if zone_group_id <= 0:
            raise SspApiError("zone_group_id must be positive")

        report_condition = self.create_ad_group_report_condition(
            token,
            start_day=start_day,
            end_day=end_day,
            zone_group_id=zone_group_id,
            zone_group_name=zone_group_name,
        )
        report_id = _coerce_int((report_condition.get("data") or {}).get("id"))
        if report_id <= 0:
            raise SspApiError(f"report-conditions 未回傳有效 id: {report_condition}")
        report_result = self.get_report_result(token, report_id=report_id)
        data = report_result.get("data")
        if not isinstance(data, dict):
            raise SspApiError("report result 缺少 data object")
        rows = data.get("data")
        if not isinstance(rows, list):
            raise SspApiError("report result 缺少 data rows")
        return {
            "auth": auth,
            "login": login_info,
            "report_condition": report_condition,
            "report_id": report_id,
            "report_ids": [report_id],
            "report_result": report_result,
            "rows": [row for row in rows if isinstance(row, dict)],
            "records_total": _coerce_int(data.get("recordsTotal")),
            "sum_row": data.get("sumRow") if isinstance(data.get("sumRow"), dict) else {},
            "zone_group_id": zone_group_id,
            "chunk_mode": "single",
            "chunk_days": (end_dt - start_dt).days + 1,
        }

    def fetch_monthly_zone_campaign_size_bundle(
        self,
        *,
        start_day: str,
        end_day: str,
        pb: int = 1,
        dimensions: list[dict[str, object]] | None = None,
    ) -> dict[str, object]:
        auth = self._auth.authenticate()
        token = _strip_text(auth.get("token"))
        login_info = self.get_login_info(token)
        start_dt = _parse_iso_date(start_day)
        end_dt = _parse_iso_date(end_day)
        if start_dt > end_dt:
            raise SspApiError("start_day cannot be after end_day")

        report_condition = self.create_monthly_zone_campaign_size_report_condition(
            token,
            start_day=start_day,
            end_day=end_day,
            pb=pb,
            dimensions=dimensions,
        )
        report_id = _coerce_int((report_condition.get("data") or {}).get("id"))
        if report_id <= 0:
            raise SspApiError(f"report-conditions 未回傳有效 id: {report_condition}")
        report_result = self.get_report_result(token, report_id=report_id)
        data = report_result.get("data")
        if not isinstance(data, dict):
            raise SspApiError("report result 缺少 data object")
        rows = data.get("data")
        if not isinstance(rows, list):
            raise SspApiError("report result 缺少 data rows")
        return {
            "auth": auth,
            "login": login_info,
            "report_condition": report_condition,
            "report_id": report_id,
            "report_ids": [report_id],
            "report_result": report_result,
            "rows": [row for row in rows if isinstance(row, dict)],
            "records_total": _coerce_int(data.get("recordsTotal")),
            "sum_row": data.get("sumRow") if isinstance(data.get("sumRow"), dict) else {},
            "pb": int(pb),
            "chunk_mode": "single",
            "chunk_days": (end_dt - start_dt).days + 1,
        }

    def fetch_monthly_country_bundle(
        self,
        *,
        start_day: str,
        end_day: str,
        pb: int = 0,
        zone_group_id: int | None = None,
    ) -> dict[str, object]:
        auth = self._auth.authenticate()
        token = _strip_text(auth.get("token"))
        login_info = self.get_login_info(token)
        start_dt = _parse_iso_date(start_day)
        end_dt = _parse_iso_date(end_day)
        if start_dt > end_dt:
            raise SspApiError("start_day cannot be after end_day")

        report_condition = self.create_monthly_country_report_condition(
            token,
            start_day=start_day,
            end_day=end_day,
            pb=pb,
            zone_group_id=zone_group_id,
        )
        report_id = _coerce_int((report_condition.get("data") or {}).get("id"))
        if report_id <= 0:
            raise SspApiError(f"report-conditions 未回傳有效 id: {report_condition}")
        report_result = self.get_report_result(token, report_id=report_id)
        data = report_result.get("data")
        if not isinstance(data, dict):
            raise SspApiError("report result 缺少 data object")
        rows = data.get("data")
        if not isinstance(rows, list):
            raise SspApiError("report result 缺少 data rows")
        return {
            "auth": auth,
            "login": login_info,
            "report_condition": report_condition,
            "report_id": report_id,
            "report_ids": [report_id],
            "report_result": report_result,
            "rows": [row for row in rows if isinstance(row, dict)],
            "records_total": _coerce_int(data.get("recordsTotal")),
            "sum_row": data.get("sumRow") if isinstance(data.get("sumRow"), dict) else {},
            "pb": int(pb),
            "zone_group_id": int(zone_group_id or 0),
            "chunk_mode": "single",
            "chunk_days": (end_dt - start_dt).days + 1,
        }

    def get_login_info(self, token: str) -> dict[str, object]:
        payload = _request_json(
            self.settings.get_login_url,
            method="GET",
            headers={"Authorization": f"Bearer {token}"},
            timeout_seconds=self.settings.timeout_seconds,
        )
        if _coerce_int(payload.get("id")) <= 0:
            raise SspAuthError(f"get-login 回傳無效: {payload}")
        return payload

    def create_report_condition(self, token: str, *, start_day: str, end_day: str) -> dict[str, object]:
        payload = _request_json(
            self.settings.report_conditions_url,
            method="POST",
            headers={"Authorization": f"Bearer {token}"},
            json_body=build_ssp_report_condition_payload(start_day=start_day, end_day=end_day),
            timeout_seconds=self.settings.timeout_seconds,
        )
        if _strip_text(payload.get("code")) != "200":
            raise SspApiError(f"report-conditions failed: {payload}")
        return payload

    def create_ad_group_report_condition(
        self,
        token: str,
        *,
        start_day: str,
        end_day: str,
        zone_group_id: int,
        zone_group_name: str = "",
    ) -> dict[str, object]:
        payload = _request_json(
            self.settings.report_conditions_url,
            method="POST",
            headers={"Authorization": f"Bearer {token}"},
            json_body=build_ssp_ad_group_report_condition_payload(
                start_day=start_day,
                end_day=end_day,
                zone_group_id=zone_group_id,
                zone_group_name=zone_group_name,
            ),
            timeout_seconds=self.settings.timeout_seconds,
        )
        if _strip_text(payload.get("code")) != "200":
            raise SspApiError(f"report-conditions failed: {payload}")
        return payload

    def create_monthly_zone_campaign_size_report_condition(
        self,
        token: str,
        *,
        start_day: str,
        end_day: str,
        pb: int = 1,
        dimensions: list[dict[str, object]] | None = None,
    ) -> dict[str, object]:
        payload = _request_json(
            self.settings.report_conditions_url,
            method="POST",
            headers={"Authorization": f"Bearer {token}"},
            json_body=build_ssp_monthly_zone_campaign_size_report_condition_payload(
                start_day=start_day,
                end_day=end_day,
                pb=pb,
                dimensions=dimensions,
            ),
            timeout_seconds=self.settings.timeout_seconds,
        )
        if _strip_text(payload.get("code")) != "200":
            raise SspApiError(f"report-conditions failed: {payload}")
        return payload

    def create_monthly_country_report_condition(
        self,
        token: str,
        *,
        start_day: str,
        end_day: str,
        pb: int = 0,
        zone_group_id: int | None = None,
    ) -> dict[str, object]:
        payload = _request_json(
            self.settings.report_conditions_url,
            method="POST",
            headers={"Authorization": f"Bearer {token}"},
            json_body=build_ssp_monthly_country_report_condition_payload(
                start_day=start_day,
                end_day=end_day,
                pb=pb,
                zone_group_id=zone_group_id,
            ),
            timeout_seconds=self.settings.timeout_seconds,
        )
        if _strip_text(payload.get("code")) != "200":
            raise SspApiError(f"report-conditions failed: {payload}")
        return payload

    def get_report_result(self, token: str, *, report_id: int) -> dict[str, object]:
        payload = _request_json(
            self.settings.report_result_url(report_id),
            method="POST",
            headers={"Authorization": f"Bearer {token}"},
            json_body={},
            timeout_seconds=self.settings.timeout_seconds,
        )
        if _strip_text(payload.get("code")) != "200":
            raise SspApiError(f"report result failed: {payload}")
        return payload


def normalize_ssp_report_rows(rows: list[dict[str, object]], *, source_name: str = DEFAULT_SOURCE_NAME) -> list[dict[str, object]]:
    normalized: list[dict[str, object]] = []
    for row in rows:
        ts = _strip_text(row.get("data_time"))
        date_text = ts[:10] if len(ts) >= 10 else ""
        hour_text = ts[11:13] if len(ts) >= 13 else ""
        normalized.append(
            {
                "source": source_name,
                "ts": ts,
                "date": date_text,
                "hour": _coerce_int(hour_text),
                "placement_id": _coerce_int(row.get("zone_id")),
                "placement_name": _strip_text(row.get("zoneName")),
                "request": _coerce_float(row.get("request")),
                "impression": _coerce_float(row.get("impress")),
                "clicks": _coerce_float(row.get("click")),
                "revenue": _coerce_float(row.get("profit")),
                "dsp_amount": _coerce_float(row.get("advertiser_mu")),
                "order_id": "",
                "order_name": "",
                "supplier_id": _coerce_int(row.get("supplier_id")),
                "supplier_name": _strip_text(row.get("supplierName")),
                "site_id": _coerce_int(row.get("site_id")),
                "site_name": _strip_text(row.get("siteName")),
            }
        )
    return normalized


def normalize_ssp_ad_group_report_rows(
    rows: list[dict[str, object]],
    *,
    zone_group_id: int,
    source_name: str = DEFAULT_SOURCE_NAME,
) -> list[dict[str, object]]:
    normalized: list[dict[str, object]] = []
    for row in rows:
        ts = _strip_text(row.get("data_time"))
        date_text = ts[:10] if len(ts) >= 10 else ts
        request = _coerce_float(row.get("request"))
        impress = _coerce_float(row.get("impress"))
        click = _coerce_float(row.get("click"))
        profit = _coerce_float(row.get("profit"))
        advertiser_mu = _coerce_float(row.get("advertiser_mu"))
        normalized.append(
            {
                "source": source_name,
                "zone_group_id": int(zone_group_id),
                "date": date_text,
                "zone_id": _coerce_int(row.get("zone_id")),
                "zone_name": _strip_text(row.get("zoneName")),
                "request": request,
                "impress": impress,
                "active_view": _coerce_float(row.get("active_view")),
                "active_view_rate": _coerce_float(row.get("active_view_rate")),
                "click": click,
                "ctr": _coerce_float(row.get("ctr")) or _safe_rate(click, impress, scale=100.0),
                "ecpm": _coerce_float(row.get("ecpm")) or _safe_rate(profit, impress, scale=1000.0),
                "ecpc": _coerce_float(row.get("ecpc")) or _safe_rate(profit, click, scale=1.0),
                "invalid_impress": _coerce_float(row.get("invalid_impress")),
                "invalid_click": _coerce_float(row.get("invalid_click")),
                "profit": profit,
                "site_mu": _coerce_float(row.get("site_mu")),
                "advertiser_mu": advertiser_mu,
                "dsp_ecpm": _coerce_float(row.get("dsp_ecpm")) or _safe_rate(advertiser_mu, impress, scale=1000.0),
                "dsp_ecpc": _coerce_float(row.get("dsp_ecpc")) or _safe_rate(advertiser_mu, click, scale=1.0),
            }
        )
    return normalized


def normalize_ssp_monthly_zone_campaign_size_rows(
    rows: list[dict[str, object]],
    *,
    source_name: str = DEFAULT_SOURCE_NAME,
) -> list[dict[str, object]]:
    normalized: list[dict[str, object]] = []
    for row in rows:
        month_text = _strip_text(row.get("data_time"))[:7]
        request = _coerce_float(row.get("request"))
        impress = _coerce_float(row.get("impress"))
        click = _coerce_float(row.get("click"))
        profit = _coerce_float(row.get("profit"))
        advertiser_mu = _coerce_float(row.get("advertiser_mu"))
        normalized.append(
            {
                "source": source_name,
                "month": month_text,
                "data_time": _strip_text(row.get("data_time")),
                "zone_id": _coerce_int(row.get("zone_id")),
                "zone_name": _strip_text(row.get("zoneName")),
                "campaign_id": _strip_text(row.get("campaign_id")),
                "campaign_name": _strip_text(row.get("campaignName")),
                "creative_size_id": _strip_text(row.get("creative_size_id")),
                "request": request,
                "impress": impress,
                "active_view": _coerce_float(row.get("active_view")),
                "active_view_rate": _coerce_float(row.get("active_view_rate")),
                "click": click,
                "ctr": _coerce_float(row.get("ctr")) or _safe_rate(click, impress, scale=100.0),
                "ecpm": _coerce_float(row.get("ecpm")) or _safe_rate(profit, impress, scale=1000.0),
                "ecpc": _coerce_float(row.get("ecpc")) or _safe_rate(profit, click, scale=1.0),
                "invalid_impress": _coerce_float(row.get("invalid_impress")),
                "invalid_click": _coerce_float(row.get("invalid_click")),
                "profit": profit,
                "site_mu": _coerce_float(row.get("site_mu")),
                "advertiser_mu": advertiser_mu,
                "dsp_ecpm": _coerce_float(row.get("dsp_ecpm")) or _safe_rate(advertiser_mu, impress, scale=1000.0),
                "dsp_ecpc": _coerce_float(row.get("dsp_ecpc")) or _safe_rate(advertiser_mu, click, scale=1.0),
            }
        )
        normalized_row = normalized[-1]
        classification = classify_dsp_row(
            {
                "訂單": normalized_row["campaign_name"] or normalized_row["campaign_id"],
                "素材": f"{normalized_row['zone_name']} {normalized_row['campaign_name']}",
                "廣告形式": normalized_row["creative_size_id"],
                "尺寸": normalized_row["creative_size_id"],
                "素材樣板": normalized_row["creative_size_id"],
                "cpm": normalized_row["dsp_ecpm"],
            }
        )
        normalized_row["ad_format"] = classification["最終廣告形式"]
        normalized_row["ad_format_rule"] = classification["規則命中_廣告形式"]
    return normalized


def normalize_ssp_monthly_country_rows(
    rows: list[dict[str, object]],
    *,
    source_name: str = DEFAULT_SOURCE_NAME,
    country_scope: str = "total",
    zone_group_id: int = 0,
) -> list[dict[str, object]]:
    normalized: list[dict[str, object]] = []
    for row in rows:
        data_time = _strip_text(row.get("data_time"))
        normalized.append(
            {
                "source": source_name,
                "month": data_time[:7],
                "data_time": data_time,
                "country": _strip_text(row.get("country")),
                "country_scope": str(country_scope or "total"),
                "zone_group_id": int(zone_group_id or 0),
                "request": _coerce_float(row.get("request")),
                "impress": _coerce_float(row.get("impress")),
            }
        )
    return normalized
