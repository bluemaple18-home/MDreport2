import assert from "node:assert/strict";
import test from "node:test";
import {
  filterDspRawdataRows,
  hasDspRowsInDateBucket,
  resolvePreferredDspDateBucket,
} from "../src/shell/dspRawdataFilters.ts";

const reference = new Date("2026-05-12T12:00:00");

test("date bucket presence ignores facet filters", () => {
  const rows = [
    { 日期時間: "2026-05-05", 最終經銷商: "A 經銷商", 最終廣告形式: "一般廣告" },
    { 日期時間: "2026-04-28", 最終經銷商: "B 經銷商", 最終廣告形式: "影音" },
  ];

  const filtered = filterDspRawdataRows(
    rows,
    {
      dateBucket: "last_week",
      distributor: "不存在的經銷商",
      adFormat: "",
      size: "",
      template: "",
    },
    1,
    reference,
  );

  assert.equal(filtered.length, 0);
  assert.equal(hasDspRowsInDateBucket(rows, "last_week", reference), true);
  assert.equal(resolvePreferredDspDateBucket(rows, reference), "last_week");
});
