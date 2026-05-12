import assert from "node:assert/strict";
import test from "node:test";
import {
  filterSupplierSummaries,
  isAsciiDigitInput,
  isLatestDateAnomaly,
  isSupplierLevelAnomaly,
  normalizeAsciiDigitInput,
} from "../src/components/workspaces/sspParityRules.ts";

test("only latest-day supplier-level DoD anomalies enter the anomaly list", () => {
  const summaries = [
    { supplier: "A", anomalyDayCount: 0, anomalySiteCount: 3, latestDateAnomaly: false },
    { supplier: "B", anomalyDayCount: 2, anomalySiteCount: 0, latestDateAnomaly: false },
    { supplier: "C", anomalyDayCount: 0, anomalySiteCount: 0, latestDateAnomaly: false },
    { supplier: "D", anomalyDayCount: 1, anomalySiteCount: 0, latestDateAnomaly: true },
  ];

  const filtered = filterSupplierSummaries("anomaly", summaries);

  assert.deepEqual(
    filtered.map((item) => item.supplier),
    ["D"],
  );
});

test("supplier row red state follows latest-day supplier-level DoD only", () => {
  assert.equal(isSupplierLevelAnomaly({ anomalyDayCount: 0, anomalySiteCount: 5, latestDateAnomaly: false }), false);
  assert.equal(isSupplierLevelAnomaly({ anomalyDayCount: 1, anomalySiteCount: 0, latestDateAnomaly: false }), false);
  assert.equal(isSupplierLevelAnomaly({ anomalyDayCount: 1, anomalySiteCount: 0, latestDateAnomaly: true }), true);
});

test("latest date anomaly drives supplier row highlight", () => {
  assert.equal(isLatestDateAnomaly({ "2026-05-10": false, "2026-05-09": true }, "2026-05-10"), false);
  assert.equal(isLatestDateAnomaly({ "2026-05-10": true, "2026-05-09": false }, "2026-05-10"), true);
});

test("DoD threshold accepts ASCII digits only", () => {
  assert.equal(isAsciiDigitInput("500"), true);
  assert.equal(isAsciiDigitInput(""), true);
  assert.equal(isAsciiDigitInput("５００"), false);
  assert.equal(isAsciiDigitInput("50.5"), false);
  assert.equal(isAsciiDigitInput("-500"), false);
  assert.equal(isAsciiDigitInput("5e2"), false);
  assert.equal(normalizeAsciiDigitInput("5０a0.2"), "502");
  assert.equal(normalizeAsciiDigitInput("0300"), "300");
  assert.equal(normalizeAsciiDigitInput("000"), "0");
  assert.equal(normalizeAsciiDigitInput(""), "");
});
