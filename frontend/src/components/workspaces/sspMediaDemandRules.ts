export type DemandMetricKey = "request" | "impression" | "fr" | "ctr" | "ecpm" | "cpc" | "complianceRate";
export type DemandMetricMode = "traffic" | "performance";
export type DemandScope = "all" | "07-22";
export type DemandMetricSpec = {
  key: Exclude<DemandMetricKey, "complianceRate">;
  label: string;
};
export type DemandScopeGroup = {
  scope: DemandScope;
  label: string;
  metrics: DemandMetricSpec[];
};

export const DEMAND_METRIC_MODES: Array<{ key: DemandMetricMode; label: string }> = [
  { key: "traffic", label: "流量" },
  { key: "performance", label: "成效" },
];

const DEMAND_SCOPE_LABELS: Record<DemandScope, string> = {
  all: "全時段",
  "07-22": "0700-2200",
};

const DEMAND_METRICS_BY_MODE: Record<DemandMetricMode, DemandMetricSpec[]> = {
  traffic: [
    { key: "request", label: "請求" },
    { key: "impression", label: "曝光" },
    { key: "fr", label: "FR" },
  ],
  performance: [
    { key: "cpc", label: "CPC" },
    { key: "ecpm", label: "CPM" },
    { key: "ctr", label: "CTR" },
  ],
};

export function buildDemandScopeGroups(scope: DemandScope, mode: DemandMetricMode): DemandScopeGroup[] {
  return [
    {
      scope,
      label: DEMAND_SCOPE_LABELS[scope],
      metrics: DEMAND_METRICS_BY_MODE[mode],
    },
  ];
}

export function showDemandComplianceColumn(mode: DemandMetricMode): boolean {
  return mode === "traffic";
}
