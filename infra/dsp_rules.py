from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

DEFAULT_RULES: dict[str, Any] = {
    "keyword_fields": ["經銷商", "訂單", "素材", "素材樣板", "廣告形式", "尺寸"],
    "display_320x480_templates": ["直播廣告", "直撥廣告", "Zip", "圖文", "圖像"],
    "distributor_aliases": [
        {"from": "營銷事業處", "to": "[台灣]域動行銷股份有限公司"},
    ],
    "internal_distributor_exact": [
        "[台灣]域動行銷股份有限公司",
        "域動行銷-MD",
        "域動行銷-PM&RD",
        "策略發展部",
        "QA經銷商",
    ],
    "internal_distributor_keywords": ["域動"],
    "io_commission_keywords": ["momo", "momo直播", "momolive"],
    "dooh_keywords": ["dooh"],
    "dooh_beiliu_keywords": ["北流"],
    "hb_vendor_keywords": ["appier", "bridgewell", "宇匯", "criteo", "rtbhouse", "teads", "ucfunnel", "酷比"],
    "preroll_keywords": ["preroll", "pre-roll", "pre roll"],
    "ad_format_dooh_keywords": ["北流"],
    "ad_format_dooh_size_keywords": ["2048x2560"],
    "ad_format_video_keywords": ["影音", "scroller"],
    "ad_format_creative_keywords": [
        "特效",
        "蓋板",
        "蓋版",
        "彈出",
        "上翻",
        "拆封",
        "玩轉",
        "內文",
        "經典畫廊",
        "旋轉",
        "磁浮",
        "對焦",
        "頁緣",
        "圖卡",
        "變身",
        "變形",
        "跑馬燈",
        "雙喜臨門",
        "置底滑動",
        "漂浮",
        "幻燈片",
        "上拉純圖",
        "創意置底banner",
        "移動大看板(圖片)",
        "開場特效",
    ],
}

MOMO_CLASSIFY_FIELDS = ["訂單", "素材", "素材樣板"]
MOMO_KEYWORDS = ["momo直播", "momo live", "momolive", "momo_liveshow", "momo-live", "momo"]
PREROLL_KEYWORDS = DEFAULT_RULES["preroll_keywords"]

RULES_PATH = Path(__file__).resolve().parents[1] / "config" / "dsp_classification_rules.json"


def _normalize_text_token(value: Any) -> str:
    text = str(value or "").strip().lower()
    return re.sub(r"[\s_\-]+", "", text)


def _coerce_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() in {"nan", "none", "<na>"} else text


def _coerce_float(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if text == "" or text.lower() in {"nan", "none", "<na>"}:
        return None
    try:
        return float(text)
    except Exception:
        return None


def _coerce_effective_cpm(row: Mapping[str, Any]) -> float | None:
    for key in ("cpm", "CPM", "ecpm", "eCPM"):
        value = _coerce_float(row.get(key))
        if value is not None:
            return value
    return None


def _sanitize_rule_config(payload: dict[str, Any]) -> dict[str, Any]:
    out = dict(DEFAULT_RULES)
    for key, value in (payload or {}).items():
        if key == "distributor_aliases" and isinstance(value, list):
            aliases: list[dict[str, str]] = []
            for item in value:
                if not isinstance(item, dict):
                    continue
                src = str(item.get("from") or item.get("src") or "").strip()
                dst = str(item.get("to") or item.get("dst") or "").strip()
                if src and dst:
                    aliases.append({"from": src, "to": dst})
            if aliases:
                out[key] = aliases
        elif isinstance(out.get(key), list) and isinstance(value, list):
            out[key] = [str(v) for v in value if str(v).strip()]
    return out


@lru_cache(maxsize=1)
def load_rule_config() -> dict[str, Any]:
    if not RULES_PATH.exists():
        return dict(DEFAULT_RULES)
    try:
        raw = json.loads(RULES_PATH.read_text(encoding="utf-8"))
    except Exception:
        return dict(DEFAULT_RULES)
    if not isinstance(raw, dict):
        return dict(DEFAULT_RULES)
    return _sanitize_rule_config(raw)


def _pick_first_hit(text_token: str, keywords: list[str]) -> str:
    for kw in keywords:
        token = _normalize_text_token(kw)
        if token and token in text_token:
            return kw
    return ""


def _build_search_token(row: Mapping[str, Any], fields: list[str]) -> str:
    parts: list[str] = []
    for col in fields:
        parts.append(_coerce_text(row.get(col, "")))
    return _normalize_text_token(" ".join(parts))


def _resolve_distributor_alias(raw_distributor: str, rules: dict[str, Any]) -> tuple[str, str]:
    raw_token = _normalize_text_token(raw_distributor)
    aliases = rules.get("distributor_aliases", [])
    if not isinstance(aliases, list):
        return raw_distributor, ""
    for item in aliases:
        if not isinstance(item, dict):
            continue
        src = str(item.get("from") or "").strip()
        dst = str(item.get("to") or "").strip()
        if not src or not dst:
            continue
        if raw_token == _normalize_text_token(src):
            return dst, f"alias:{src}"
    return raw_distributor, ""


def _infer_ad_format(row: Mapping[str, Any], rules: dict[str, Any]) -> tuple[str, str]:
    """依原始欄位推回最終廣告形式。"""
    size_token = _normalize_text_token(_coerce_text(row.get("尺寸", "") or row.get("size_id", "")))
    raw_ad = _coerce_text(row.get("廣告形式", "") or row.get("size_id", "") or row.get("ad_format", ""))
    raw_ad_token = _normalize_text_token(raw_ad)
    template_token = _normalize_text_token(_coerce_text(row.get("素材樣板", "") or row.get("content_type", "")))
    display_320x480_templates = [str(v) for v in rules.get("display_320x480_templates", [])]

    display_320x480_hit = _pick_first_hit(template_token, display_320x480_templates)
    if display_320x480_hit and "320x480" in size_token:
        return "一般廣告", "rule:display_320x480_template"

    if raw_ad in {"一般廣告", "創意廣告", "DOOH北流", "影音摩天", "preroll"}:
        return raw_ad, "rule:canonical"

    token_fields = ["廣告形式", "訂單", "素材樣板", "尺寸", "素材"]
    token = _build_search_token(row, token_fields)
    effective_cpm = _coerce_effective_cpm(row)
    if effective_cpm is not None and ("16:9影音廣告" in size_token or "169影音廣告" in size_token):
        if effective_cpm < 40:
            return "影音摩天", "rule:video_16_9_cpm_lt40"
        if effective_cpm <= 200:
            return "創意廣告", "rule:video_16_9_cpm_40_200"
        return "preroll", "rule:video_16_9_cpm_ge201"

    preroll_hit = _pick_first_hit(token, [str(v) for v in rules.get("preroll_keywords", PREROLL_KEYWORDS)])
    if preroll_hit:
        return "preroll", "rule:preroll"

    dooh_hit = _pick_first_hit(token, [str(v) for v in rules.get("ad_format_dooh_keywords", [])])
    dooh_size_hit = _pick_first_hit(token, [str(v) for v in rules.get("ad_format_dooh_size_keywords", [])])
    if dooh_hit or dooh_size_hit:
        return "DOOH北流", "rule:dooh_beiliu"

    video_hit = _pick_first_hit(token, [str(v) for v in rules.get("ad_format_video_keywords", [])])
    if video_hit:
        return "影音摩天", "rule:video"

    creative_hit = _pick_first_hit(token, [str(v) for v in rules.get("ad_format_creative_keywords", [])])
    if creative_hit:
        return "創意廣告", "rule:creative"

    if raw_ad:
        video_raw_hit = _pick_first_hit(raw_ad_token, [str(v) for v in rules.get("ad_format_video_keywords", [])])
        if video_raw_hit:
            return "影音摩天", "rule:video_raw"

    return "一般廣告", "rule:default"


def classify_dsp_row(row: Mapping[str, Any], rules: dict[str, Any] | None = None) -> dict[str, str]:
    """回傳 DSP 列的最終經銷商與最終廣告形式。"""
    active_rules = rules or load_rule_config()
    raw_distributor = _coerce_text(row.get("經銷商", "") or row.get("distributor_id", ""))
    canonical_distributor, alias_hit = _resolve_distributor_alias(raw_distributor, active_rules)
    canonical_distributor_token = _normalize_text_token(canonical_distributor)

    internal_exact = {_normalize_text_token(v) for v in active_rules.get("internal_distributor_exact", [])}
    internal_keywords = [str(v) for v in active_rules.get("internal_distributor_keywords", [])]
    is_strategy = canonical_distributor_token == _normalize_text_token("策略發展部")
    is_md = canonical_distributor_token == _normalize_text_token("域動行銷-MD")
    is_internal = (
        bool(canonical_distributor_token)
        and (
            canonical_distributor_token in internal_exact
            or any(_normalize_text_token(kw) in canonical_distributor_token for kw in internal_keywords)
        )
    )
    is_non_internal = bool(canonical_distributor.strip()) and not is_internal

    token_fields = [str(v) for v in active_rules.get("keyword_fields", [])]
    token = _build_search_token(row, token_fields)
    dooh_hit = _pick_first_hit(token, [str(v) for v in active_rules.get("dooh_keywords", [])])
    beiliu_hit = _pick_first_hit(token, [str(v) for v in active_rules.get("dooh_beiliu_keywords", [])])
    io_hit = _pick_first_hit(token, [str(v) for v in active_rules.get("io_commission_keywords", [])])
    hb_hit = _pick_first_hit(token, [str(v) for v in active_rules.get("hb_vendor_keywords", [])])

    dist_level_b = ""
    dist_level_c = ""
    dist_level_d = ""
    final_distributor = ""
    hit_distributor = ""
    source_distributor = "raw"

    if canonical_distributor.strip():
        if is_strategy:
            dist_level_b = "內部經銷商"
            dist_level_c = "策略部"
        elif is_internal:
            dist_level_b = "內部經銷商"
            dist_level_c = "營銷事業處"
        else:
            dist_level_b = "外部經銷商"
            dist_level_c = "經銷推廣"

    if dooh_hit and beiliu_hit:
        dist_level_d = "DOOH北流"
        final_distributor = canonical_distributor
        hit_distributor = "dooh_beiliu"
        source_distributor = "rule"
    elif is_md and hb_hit:
        dist_level_b = "HB串接"
        dist_level_c = "MD"
        dist_level_d = hb_hit
        final_distributor = "HB串接"
        hit_distributor = "hb_vendor"
        source_distributor = "rule"
    elif is_md and io_hit:
        dist_level_b = "外部經銷商"
        dist_level_c = "IO委刊"
        dist_level_d = "momo"
        final_distributor = "IO委刊"
        hit_distributor = "io_commission"
        source_distributor = "rule"
    elif dooh_hit:
        dist_level_c = "DOOH"
        dist_level_d = "DOOH外部"
        final_distributor = "DOOH外部"
        hit_distributor = "dooh_external"
        source_distributor = "rule"
    elif is_non_internal:
        dist_level_c = "經銷推廣"
        dist_level_d = canonical_distributor
        final_distributor = "外部經銷商"
        hit_distributor = "external_distributor"
        source_distributor = "rule"
    else:
        final_distributor = canonical_distributor

    final_ad_format, ad_hit = _infer_ad_format(row, active_rules)

    return {
        "原始經銷商": raw_distributor,
        "原始廣告形式": _coerce_text(row.get("廣告形式", "") or row.get("size_id", "") or row.get("ad_format", "")),
        "最終經銷商": str(final_distributor).strip(),
        "規則命中_經銷商": hit_distributor or alias_hit,
        "最終來源_經銷商": source_distributor if hit_distributor else ("alias" if alias_hit else "raw"),
        "分類層級B": dist_level_b,
        "分類層級C": dist_level_c,
        "分類層級D": dist_level_d,
        "最終廣告形式": final_ad_format,
        "規則命中_廣告形式": ad_hit,
        "最終來源_廣告形式": ad_hit,
    }
