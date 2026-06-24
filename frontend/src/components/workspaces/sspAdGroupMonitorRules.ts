import type { SspAdGroupMetricSummary } from "../../types";

export function rowKey(row: SspAdGroupMetricSummary): string {
  return String(row.zone_group_id || row.zone_id || row.zone_group_name || row.zone_name || row.ad_format || "");
}

export function placementRowKey(row: SspAdGroupMetricSummary): string {
  return String(row.zone_id || row.zone_name || row.zone_group_id || "");
}
