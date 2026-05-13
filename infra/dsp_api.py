from __future__ import annotations

import os
import time
from datetime import date, timedelta
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from infra.ssp_api import (
    DEFAULT_AUTH_DECRYPT_KEY,
    DEFAULT_SCOPE_CHECK_URL,
    DEFAULT_TIMEOUT_SECONDS,
    DEFAULT_RANGE_DAY_PAUSE_SECONDS,
    SspApiSettings,
    SspScopeCheckAuth,
    _coerce_float,
    _coerce_int,
    _parse_iso_date,
    _request_json,
    _strip_text,
    resolve_ssp_api_settings,
)
from infra.dsp_rules import classify_dsp_row


DEFAULT_DSP_API_BASE_URL = "https://dsp3-api.holmesmind.com/api"
DEFAULT_DSP_SERVICE_ID = 10
DEFAULT_DSP_SOURCE_NAME = "dsp3_api"


@dataclass(frozen=True)
class DspApiSettings:
    email: str
    password: str
    scope_check_url: str = DEFAULT_SCOPE_CHECK_URL
    api_base_url: str = DEFAULT_DSP_API_BASE_URL
    auth_decrypt_key: str = DEFAULT_AUTH_DECRYPT_KEY
    service_id: int = DEFAULT_DSP_SERVICE_ID
    source_name: str = DEFAULT_DSP_SOURCE_NAME
    timeout_seconds: int = DEFAULT_TIMEOUT_SECONDS

    @property
    def reports_url(self) -> str:
        return f"{self.api_base_url.rstrip('/')}/v1/reports"

    @property
    def view_job_url(self) -> str:
        return f"{self.api_base_url.rstrip('/')}/v1/reports/view-job"


def resolve_dsp_api_settings(
    *,
    email: str | None = None,
    password: str | None = None,
    scope_check_url: str | None = None,
    api_base_url: str | None = None,
    auth_decrypt_key: str | None = None,
    service_id: int | None = None,
    source_name: str | None = None,
    timeout_seconds: int | None = None,
) -> DspApiSettings:
    resolved = resolve_ssp_api_settings(
        email=email or _strip_text(os.getenv("MDREP_DSP_EMAIL")) or None,
        password=password or _strip_text(os.getenv("MDREP_DSP_PASSWORD")) or None,
        scope_check_url=scope_check_url,
        api_base_url=api_base_url or _strip_text(os.getenv("MDREP_DSP_API_BASE_URL")) or DEFAULT_DSP_API_BASE_URL,
        auth_decrypt_key=auth_decrypt_key,
        service_id=service_id if service_id is not None else (_coerce_int(os.getenv("MDREP_DSP_SERVICE_ID")) or DEFAULT_DSP_SERVICE_ID),
        source_name=source_name or _strip_text(os.getenv("MDREP_DSP_SOURCE_NAME")) or DEFAULT_DSP_SOURCE_NAME,
        timeout_seconds=timeout_seconds,
    )
    return DspApiSettings(
        email=resolved.email,
        password=resolved.password,
        scope_check_url=resolved.scope_check_url,
        api_base_url=resolved.api_base_url,
        auth_decrypt_key=resolved.auth_decrypt_key,
        service_id=resolved.service_id,
        source_name=resolved.source_name,
        timeout_seconds=resolved.timeout_seconds,
    )


def build_dsp_report_payload(*, start_day: str, end_day: str) -> dict[str, object]:
    return {
        "start_date": start_day,
        "end_date": end_day,
        "report_type": "daily",
        "report_dimensions": [
            "dateTime",
            "distributor",
            "creative",
            "creativeContentType",
            "size",
            "campaign",
        ],
        "report_index": [
            "budget-1",
            "impress",
            "click",
            "ctr",
            "ecpc",
            "ecpm",
            "budget-2",
            "budget-3",
            "bidding-price",
        ],
        "report_campaign_type": ["general_campaign"],
        "strategy_kpi_filter": [],
        "distributor_filter": [],
        "media_distribution_filter": [],
        "advertiser_filter": [],
        "campaign_filter": [],
        "strategy_filter": [],
        "creative_filter": [],
        "site_filter": [],
        "content_type_filter": [],
        "size_filter": [],
        "currency": "TWD",
    }


def _parse_view_job_rows(payload: dict[str, object]) -> list[dict[str, object]]:
    data_block = payload.get("data")
    if not isinstance(data_block, dict):
        return []
    json_block = data_block.get("json")
    if not isinstance(json_block, dict):
        return []
    title_raw = json_block.get("title")
    rows_raw = json_block.get("data")
    if not isinstance(title_raw, dict) or not isinstance(rows_raw, list):
        return []
    ordered = sorted(title_raw.items(), key=lambda kv: int(str(kv[0])))
    field_names = [str(v).replace("Report.newReport.", "") for _, v in ordered]
    out: list[dict[str, object]] = []
    for raw_row in rows_raw:
        if not isinstance(raw_row, list):
            continue
        mapped: dict[str, object] = {}
        for idx, field in enumerate(field_names):
            mapped[field] = raw_row[idx] if idx < len(raw_row) else None
        out.append(mapped)
    return out


class DspApiClient:
    def __init__(self, settings: DspApiSettings) -> None:
        self.settings = settings

    def fetch_report_bundle(self, *, start_day: str, end_day: str) -> dict[str, object]:
        auth = SspScopeCheckAuth(
            SspApiSettings(
                email=self.settings.email,
                password=self.settings.password,
                scope_check_url=self.settings.scope_check_url,
                api_base_url=self.settings.api_base_url,
                auth_decrypt_key=self.settings.auth_decrypt_key,
                service_id=self.settings.service_id,
                source_name=self.settings.source_name,
                timeout_seconds=self.settings.timeout_seconds,
            )
        ).authenticate()
        token = _strip_text(auth.get("token"))
        start_dt = _parse_iso_date(start_day)
        end_dt = _parse_iso_date(end_day)
        if start_dt > end_dt:
            raise RuntimeError("start_day cannot be after end_day")

        report_job = None
        view_job = None
        job_id = ""
        job_ids: list[str] = []
        combined_rows: list[dict[str, object]] = []
        day_count = 0
        current = start_dt
        while current <= end_dt:
            current_day = current.isoformat()
            if day_count > 0:
                time.sleep(DEFAULT_RANGE_DAY_PAUSE_SECONDS)
            report_job = self.create_report_job(token, start_day=current_day, end_day=current_day)
            job_id = _strip_text(((report_job.get("data") or {}) if isinstance(report_job.get("data"), dict) else {}).get("job_id"))
            if not job_id:
                raise RuntimeError(f"reports 未回傳有效 job_id: {report_job}")
            job_ids.append(job_id)
            view_job = self.view_job(token, job_id=job_id, page=1)
            rows = _parse_view_job_rows(view_job)
            combined_rows.extend(rows)
            day_count += 1
            current += timedelta(days=1)

        if report_job is None or view_job is None or not job_id:
            raise RuntimeError("fetch_report_bundle did not execute any daily report requests")
        return {
            "auth": auth,
            "report_job": report_job,
            "job_id": job_id,
            "job_ids": job_ids,
            "view_job": view_job,
            "rows": combined_rows,
            "records_total": len(combined_rows),
            "model": ((view_job.get("data") or {}) if isinstance(view_job.get("data"), dict) else {}).get("model") or {},
            "chunk_mode": "daily" if day_count > 1 else "single",
            "chunk_days": day_count,
        }

    def create_report_job(self, token: str, *, start_day: str, end_day: str) -> dict[str, object]:
        payload = _request_json(
            self.settings.reports_url,
            method="POST",
            headers={"Authorization": f"Bearer {token}"},
            json_body=build_dsp_report_payload(start_day=start_day, end_day=end_day),
            timeout_seconds=self.settings.timeout_seconds,
        )
        if _coerce_int(payload.get("status")) != 200:
            raise RuntimeError(f"reports failed: {payload}")
        return payload

    def view_job(self, token: str, *, job_id: str, page: int = 1) -> dict[str, object]:
        payload = _request_json(
            f"{self.settings.view_job_url}?job_id={job_id}&page={int(page)}",
            method="GET",
            headers={"Authorization": f"Bearer {token}"},
            timeout_seconds=self.settings.timeout_seconds,
        )
        if _coerce_int(payload.get("status")) != 200:
            raise RuntimeError(f"view-job failed: {payload}")
        return payload


def normalize_dsp_report_rows(rows: list[dict[str, object]], *, source_name: str = DEFAULT_DSP_SOURCE_NAME) -> list[dict[str, object]]:
    normalized: list[dict[str, object]] = []
    for row in rows:
        distributor = _strip_text(row.get("distributor_id"))
        raw_ad_format = _strip_text(row.get("size_id")) or _strip_text(row.get("ad_format"))
        classification = classify_dsp_row(
            {
                "經銷商": distributor,
                "廣告形式": raw_ad_format,
                "尺寸": _strip_text(row.get("size_id")) or raw_ad_format,
                "素材樣板": _strip_text(row.get("content_type")),
                "訂單": _strip_text(row.get("campaign_id")),
                "素材": _strip_text(row.get("creative_id")),
                "cpm": row.get("cpm"),
                "CPM": row.get("CPM"),
                "ecpm": row.get("ecpm"),
                "eCPM": row.get("eCPM"),
            }
        )
        normalized.append(
            {
                "日期時間": _strip_text(row.get("data_time")),
                "經銷商": distributor,
                "訂單": _strip_text(row.get("campaign_id")),
                "素材": _strip_text(row.get("creative_id")),
                "廣告形式": raw_ad_format,
                "尺寸": _strip_text(row.get("size_id")) or raw_ad_format,
                "素材樣板": _strip_text(row.get("content_type")),
                "執行金額": _coerce_float(row.get("campaign_mu")),
                "系統營收": _coerce_float(row.get("distributor_mu")),
                "媒體費用": _coerce_float(row.get("advertiser_mu")),
                **classification,
            }
        )
    return normalized
