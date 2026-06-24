import assert from "node:assert/strict";
import test from "node:test";
import { buildDemandScopeGroups, showDemandComplianceColumn } from "../src/components/workspaces/sspMediaDemandRules.ts";

test("traffic mode exposes traffic metrics and compliance only for the active scope", () => {
  const groups = buildDemandScopeGroups("all", "traffic");

  assert.deepEqual(groups.map((group) => group.label), ["全時段"]);
  assert.deepEqual(groups.flatMap((group) => group.metrics.map((metric) => metric.key)), ["request", "impression", "fr"]);
  assert.equal(showDemandComplianceColumn("traffic"), true);
});

test("performance mode exposes only CPC CPM CTR without compliance", () => {
  const groups = buildDemandScopeGroups("07-22", "performance");

  assert.deepEqual(groups.map((group) => group.label), ["0700-2200"]);
  assert.deepEqual(groups.flatMap((group) => group.metrics.map((metric) => metric.key)), ["cpc", "ecpm", "ctr"]);
  assert.equal(showDemandComplianceColumn("performance"), false);
});
