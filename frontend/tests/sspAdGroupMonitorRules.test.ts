import assert from "node:assert/strict";
import test from "node:test";
import { placementRowKey, rowKey } from "../src/components/workspaces/sspAdGroupMonitorRules.ts";

test("placement table keys follow placement identity when tier rows share a group", () => {
  const highPlacement = {
    zone_group_id: 7001,
    zone_group_name: "同一廣告群組",
    zone_id: 1001,
    zone_name: "高版位",
  };
  const lowPlacement = {
    zone_group_id: 7001,
    zone_group_name: "同一廣告群組",
    zone_id: 1002,
    zone_name: "低版位",
  };

  assert.equal(rowKey(highPlacement), rowKey(lowPlacement));
  assert.notEqual(placementRowKey(highPlacement), placementRowKey(lowPlacement));
  assert.equal(placementRowKey(highPlacement), "1001");
  assert.equal(placementRowKey(lowPlacement), "1002");
});
