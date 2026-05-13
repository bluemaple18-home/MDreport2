from __future__ import annotations

import unittest
from unittest.mock import patch

from infra.dsp_api import DspApiClient, DspApiSettings, build_dsp_report_payload, normalize_dsp_report_rows


class DspApiTests(unittest.TestCase):
    def test_build_dsp_report_payload_matches_regular_contract(self) -> None:
        payload = build_dsp_report_payload(start_day="2026-05-10", end_day="2026-05-10")
        self.assertEqual(payload["start_date"], "2026-05-10")
        self.assertEqual(payload["end_date"], "2026-05-10")
        self.assertEqual(payload["report_type"], "daily")
        self.assertEqual(
            payload["report_dimensions"],
            ["dateTime", "distributor", "creative", "creativeContentType", "size", "campaign"],
        )
        self.assertEqual(
            payload["report_index"],
            ["budget-1", "impress", "click", "ctr", "ecpc", "ecpm", "budget-2", "budget-3", "bidding-price"],
        )
        self.assertEqual(payload["report_campaign_type"], ["general_campaign"])
        self.assertEqual(payload["currency"], "TWD")

    def test_normalize_dsp_report_rows_maps_view_job_row_to_canonical_contract(self) -> None:
        rows = normalize_dsp_report_rows(
            [
                {
                    "data_time": "2026-05-10",
                    "distributor_id": "[台灣]域動行銷股份有限公司",
                    "campaign_id": "(42031)活動",
                    "creative_id": "(314928)0422_純蓋板",
                    "size_id": "純蓋板",
                    "content_type": "HTML/JS",
                    "ecpm": 88.8,
                    "campaign_mu": 10934.99,
                    "distributor_mu": 8000.5,
                    "advertiser_mu": 7000.25,
                }
            ],
            source_name="dsp3_api",
        )
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["日期時間"], "2026-05-10")
        self.assertEqual(row["經銷商"], "[台灣]域動行銷股份有限公司")
        self.assertEqual(row["訂單"], "(42031)活動")
        self.assertEqual(row["素材"], "(314928)0422_純蓋板")
        self.assertEqual(row["廣告形式"], "純蓋板")
        self.assertEqual(row["尺寸"], "純蓋板")
        self.assertEqual(row["素材樣板"], "HTML/JS")
        self.assertEqual(float(row["執行金額"]), 10934.99)
        self.assertEqual(float(row["系統營收"]), 8000.5)
        self.assertEqual(float(row["媒體費用"]), 7000.25)
        self.assertEqual(row["原始經銷商"], "[台灣]域動行銷股份有限公司")
        self.assertEqual(row["原始廣告形式"], "純蓋板")
        self.assertEqual(row["最終廣告形式"], "創意廣告")
        self.assertEqual(row["最終經銷商"], "[台灣]域動行銷股份有限公司")
        self.assertEqual(row["規則命中_經銷商"], "")
        self.assertEqual(row["最終來源_經銷商"], "raw")
        self.assertEqual(row["規則命中_廣告形式"], "rule:creative")
        self.assertEqual(row["最終來源_廣告形式"], "rule:creative")
        self.assertEqual(row["分類層級B"], "內部經銷商")
        self.assertEqual(row["分類層級C"], "營銷事業處")
        self.assertEqual(row["分類層級D"], "")

    def test_normalize_dsp_report_rows_applies_original_distributor_and_ad_rules(self) -> None:
        rows = normalize_dsp_report_rows(
            [
                {
                    "data_time": "2026-05-10",
                    "distributor_id": "營銷事業處",
                    "campaign_id": "(42032)320x480 測試",
                    "creative_id": "(314929)320x480 測試素材",
                    "size_id": "320x480",
                    "content_type": "直播廣告",
                    "campaign_mu": 1,
                    "distributor_mu": 2,
                    "advertiser_mu": 3,
                },
                {
                    "data_time": "2026-05-10",
                    "distributor_id": "外部經銷商B",
                    "campaign_id": "(42033)Appier 測試",
                    "creative_id": "(314930)HB 測試",
                    "size_id": "一般尺寸",
                    "content_type": "HTML/JS",
                    "campaign_mu": 4,
                    "distributor_mu": 5,
                    "advertiser_mu": 6,
                },
                {
                    "data_time": "2026-05-10",
                    "distributor_id": "域動行銷-MD",
                    "campaign_id": "(42033)Appier 測試",
                    "creative_id": "(314930)HB 測試",
                    "size_id": "一般尺寸",
                    "content_type": "HTML/JS",
                    "campaign_mu": 4,
                    "distributor_mu": 5,
                    "advertiser_mu": 6,
                },
                {
                    "data_time": "2026-05-10",
                    "distributor_id": "外部經銷商C",
                    "campaign_id": "(42034)16:9 影音測試",
                    "creative_id": "(314931)16:9 影音",
                    "size_id": "16:9影音廣告",
                    "content_type": "HTML/JS",
                    "ecpm": 35,
                    "campaign_mu": 4,
                    "distributor_mu": 5,
                    "advertiser_mu": 6,
                },
                {
                    "data_time": "2026-05-10",
                    "distributor_id": "外部經銷商A",
                    "campaign_id": "(42035)一般廣告",
                    "creative_id": "(314932)一般素材",
                    "size_id": "一般廣告",
                    "content_type": "HTML/JS",
                    "campaign_mu": 7,
                    "distributor_mu": 8,
                    "advertiser_mu": 9,
                },
            ],
            source_name="dsp3_api",
        )

        self.assertEqual(rows[0]["最終經銷商"], "[台灣]域動行銷股份有限公司")
        self.assertEqual(rows[0]["規則命中_經銷商"], "alias:營銷事業處")
        self.assertEqual(rows[0]["最終來源_經銷商"], "alias")
        self.assertEqual(rows[0]["最終廣告形式"], "一般廣告")
        self.assertEqual(rows[0]["規則命中_廣告形式"], "rule:display_320x480_template")

        self.assertEqual(rows[1]["最終經銷商"], "外部經銷商")
        self.assertEqual(rows[1]["規則命中_經銷商"], "external_distributor")
        self.assertEqual(rows[1]["最終來源_經銷商"], "rule")
        self.assertEqual(rows[1]["最終廣告形式"], "一般廣告")
        self.assertEqual(rows[1]["規則命中_廣告形式"], "rule:default")

        self.assertEqual(rows[2]["最終經銷商"], "HB串接")
        self.assertEqual(rows[2]["規則命中_經銷商"], "hb_vendor")
        self.assertEqual(rows[2]["最終來源_經銷商"], "rule")
        self.assertEqual(rows[2]["分類層級B"], "HB串接")
        self.assertEqual(rows[2]["分類層級C"], "MD")
        self.assertEqual(rows[2]["分類層級D"], "appier")

        self.assertEqual(rows[3]["最終經銷商"], "外部經銷商")
        self.assertEqual(rows[3]["規則命中_經銷商"], "external_distributor")
        self.assertEqual(rows[3]["最終來源_經銷商"], "rule")
        self.assertEqual(rows[3]["最終廣告形式"], "影音摩天")
        self.assertEqual(rows[3]["規則命中_廣告形式"], "rule:video_16_9_cpm_lt40")

        self.assertEqual(rows[4]["最終經銷商"], "外部經銷商")
        self.assertEqual(rows[4]["規則命中_經銷商"], "external_distributor")
        self.assertEqual(rows[4]["最終來源_經銷商"], "rule")
        self.assertEqual(rows[4]["最終廣告形式"], "一般廣告")
        self.assertEqual(rows[4]["規則命中_廣告形式"], "rule:canonical")

    def test_playart_stays_external_promotion_even_when_live_keyword_matches(self) -> None:
        rows = normalize_dsp_report_rows(
            [
                {
                    "data_time": "2026-05-10",
                    "distributor_id": "玩藝國際股份有限公司",
                    "campaign_id": "(42036)momo直播 測試",
                    "creative_id": "(314933)直播素材",
                    "size_id": "300x250",
                    "content_type": "HTML/JS",
                    "campaign_mu": 123.45,
                    "distributor_mu": 123.45,
                    "advertiser_mu": 123.45,
                }
            ],
            source_name="dsp3_api",
        )

        row = rows[0]
        self.assertEqual(row["最終經銷商"], "外部經銷商")
        self.assertEqual(row["分類層級B"], "外部經銷商")
        self.assertEqual(row["分類層級C"], "經銷推廣")
        self.assertEqual(row["分類層級D"], "玩藝國際股份有限公司")
        self.assertEqual(row["規則命中_經銷商"], "external_distributor")

    def test_md_momo_is_io_but_marketing_momo_stays_internal(self) -> None:
        rows = normalize_dsp_report_rows(
            [
                {
                    "data_time": "2026-05-10",
                    "distributor_id": "域動行銷-MD",
                    "campaign_id": "(42037)momo直播 專案",
                    "creative_id": "(314934)momo素材",
                    "size_id": "300x250",
                    "content_type": "HTML/JS",
                    "campaign_mu": 100,
                    "distributor_mu": 100,
                    "advertiser_mu": 100,
                },
                {
                    "data_time": "2026-05-10",
                    "distributor_id": "營銷事業處",
                    "campaign_id": "(42038)momo直播 專案",
                    "creative_id": "(314935)momo素材",
                    "size_id": "300x250",
                    "content_type": "HTML/JS",
                    "campaign_mu": 100,
                    "distributor_mu": 100,
                    "advertiser_mu": 100,
                },
            ],
            source_name="dsp3_api",
        )

        self.assertEqual(rows[0]["最終經銷商"], "IO委刊")
        self.assertEqual(rows[0]["分類層級B"], "外部經銷商")
        self.assertEqual(rows[0]["分類層級C"], "IO委刊")
        self.assertEqual(rows[0]["分類層級D"], "momo")
        self.assertEqual(rows[0]["規則命中_經銷商"], "io_commission")

        self.assertEqual(rows[1]["最終經銷商"], "[台灣]域動行銷股份有限公司")
        self.assertEqual(rows[1]["分類層級B"], "內部經銷商")
        self.assertEqual(rows[1]["分類層級C"], "營銷事業處")
        self.assertEqual(rows[1]["規則命中_經銷商"], "alias:營銷事業處")

    def test_md_hb_vendor_wins_over_momo_keyword(self) -> None:
        rows = normalize_dsp_report_rows(
            [
                {
                    "data_time": "2026-05-10",
                    "distributor_id": "域動行銷-MD",
                    "campaign_id": "(42039)momo直播 Appier 專案",
                    "creative_id": "(314936)momo素材",
                    "size_id": "300x250",
                    "content_type": "HTML/JS",
                    "campaign_mu": 100,
                    "distributor_mu": 100,
                    "advertiser_mu": 100,
                },
            ],
            source_name="dsp3_api",
        )

        self.assertEqual(rows[0]["最終經銷商"], "HB串接")
        self.assertEqual(rows[0]["分類層級B"], "HB串接")
        self.assertEqual(rows[0]["分類層級C"], "MD")
        self.assertEqual(rows[0]["分類層級D"], "appier")
        self.assertEqual(rows[0]["規則命中_經銷商"], "hb_vendor")

    def test_fetch_report_bundle_aggregates_multi_day_range_as_daily_chunks(self) -> None:
        client = DspApiClient(DspApiSettings(email="matt@clickforce.com.tw", password="24450379"))

        with (
            patch("infra.dsp_api.SspScopeCheckAuth.authenticate", return_value={"service_id": 10, "token": "dsp-token-10", "user": {"id": 2072}}),
            patch.object(
                client,
                "create_report_job",
                side_effect=[
                    {"data": {"job_id": "job-a"}},
                    {"data": {"job_id": "job-b"}},
                ],
            ) as mock_create,
            patch.object(
                client,
                "view_job",
                side_effect=[
                    {
                        "status": 200,
                        "data": {
                            "json": {
                                "title": {
                                    "0": "Report.newReport.data_time",
                                    "2": "Report.newReport.distributor_id",
                                },
                                "data": [
                                    ["2026-05-10", "A"],
                                    ["2026-05-10", "B"],
                                ],
                            }
                        },
                    },
                    {
                        "status": 200,
                        "data": {
                            "json": {
                                "title": {
                                    "0": "Report.newReport.data_time",
                                    "2": "Report.newReport.distributor_id",
                                },
                                "data": [
                                    ["2026-05-11", "C"],
                                ],
                            }
                        },
                    },
                ],
            ) as mock_view,
            patch("infra.dsp_api.time.sleep", return_value=None) as mock_sleep,
        ):
            bundle = client.fetch_report_bundle(start_day="2026-05-10", end_day="2026-05-11")

        self.assertEqual(int(bundle["records_total"]), 3)
        self.assertEqual(str(bundle["job_id"]), "job-b")
        self.assertEqual(list(bundle["job_ids"]), ["job-a", "job-b"])
        self.assertEqual(str(bundle["chunk_mode"]), "daily")
        self.assertEqual(int(bundle["chunk_days"]), 2)
        self.assertEqual(len(bundle["rows"]), 3)
        self.assertEqual(mock_create.call_count, 2)
        mock_create.assert_any_call("dsp-token-10", start_day="2026-05-10", end_day="2026-05-10")
        mock_create.assert_any_call("dsp-token-10", start_day="2026-05-11", end_day="2026-05-11")
        self.assertEqual(mock_view.call_count, 2)
        mock_sleep.assert_called_once()

    def test_fetch_report_bundle_allows_empty_daily_chunk_in_range(self) -> None:
        client = DspApiClient(DspApiSettings(email="matt@clickforce.com.tw", password="24450379"))

        with (
            patch("infra.dsp_api.SspScopeCheckAuth.authenticate", return_value={"service_id": 10, "token": "dsp-token-10", "user": {"id": 2072}}),
            patch.object(
                client,
                "create_report_job",
                side_effect=[
                    {"data": {"job_id": "job-empty"}},
                    {"data": {"job_id": "job-data"}},
                ],
            ),
            patch.object(
                client,
                "view_job",
                side_effect=[
                    {
                        "status": 200,
                        "data": {
                            "json": {
                                "title": {
                                    "0": "Report.newReport.data_time",
                                    "2": "Report.newReport.distributor_id",
                                },
                                "data": [],
                            }
                        },
                    },
                    {
                        "status": 200,
                        "data": {
                            "json": {
                                "title": {
                                    "0": "Report.newReport.data_time",
                                    "2": "Report.newReport.distributor_id",
                                },
                                "data": [
                                    ["2026-05-11", "C"],
                                ],
                            }
                        },
                    },
                ],
            ),
            patch("infra.dsp_api.time.sleep", return_value=None),
        ):
            bundle = client.fetch_report_bundle(start_day="2026-05-10", end_day="2026-05-11")

        self.assertEqual(int(bundle["records_total"]), 1)
        self.assertEqual(list(bundle["job_ids"]), ["job-empty", "job-data"])
        self.assertEqual(str(bundle["chunk_mode"]), "daily")
        self.assertEqual(int(bundle["chunk_days"]), 2)
        self.assertEqual(len(bundle["rows"]), 1)
