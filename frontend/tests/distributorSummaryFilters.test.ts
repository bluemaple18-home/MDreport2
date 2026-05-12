import assert from "node:assert/strict";
import test from "node:test";
import {
  filterSummaryRows,
  isExcludedSummaryDistributor,
  resolveExcludedSummaryReason,
  summarizeExcludedSummaryRows,
} from "../src/components/workspaces/distributorSummaryFilters.ts";

test("pivot summary excludes PM RD QA and 測試 distributors", () => {
  assert.equal(isExcludedSummaryDistributor("域動行銷-PM&RD"), true);
  assert.equal(isExcludedSummaryDistributor("QA經銷商"), true);
  assert.equal(isExcludedSummaryDistributor("測試經銷商"), true);
  assert.equal(isExcludedSummaryDistributor("正式經銷商"), false);
});

test("filterSummaryRows removes excluded distributors from summary tables", () => {
  const rows = [
    { 經銷商: "域動行銷-PM&RD", 執行金額: 10 },
    { 經銷商: "QA經銷商", 執行金額: 20 },
    { 經銷商: "正式經銷商", 執行金額: 30 },
  ];

  const filtered = filterSummaryRows(rows);

  assert.deepEqual(
    filtered.map((row) => row.經銷商),
    ["正式經銷商"],
  );
});

test("summarizeExcludedSummaryRows keeps an audit trail for hidden distributors", () => {
  const rows = [
    { 經銷商: "域動行銷-PM&RD", 執行金額: 10 },
    { 經銷商: "域動行銷-PM&RD", 執行金額: 15 },
    { 經銷商: "QA經銷商", 執行金額: 20 },
    { 經銷商: "正式經銷商", 執行金額: 30 },
  ];

  const summary = summarizeExcludedSummaryRows(rows);

  assert.deepEqual(summary, [
    { 經銷商: "域動行銷-PM&RD", 排除原因: "PM / RD", 筆數: 2, 執行金額: 25 },
    { 經銷商: "QA經銷商", 排除原因: "QA", 筆數: 1, 執行金額: 20 },
  ]);
  assert.equal(resolveExcludedSummaryReason("測試經銷商"), "測試");
});
