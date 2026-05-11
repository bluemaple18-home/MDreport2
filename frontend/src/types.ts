export type Workflow = "dsp" | "ssp";
export type MainTab = "dsp_tab3" | "dsp_tab4" | "ssp_anomaly";
export type SubTab = "overview" | "rawdata" | "pivot" | "result";
export type SubView = "status" | "frame" | "result";
export type PeriodPreset = "current_week" | "last_week" | "custom";
export type DspDateBucket = "last_week" | "two_weeks_ago" | "three_weeks_ago" | "four_weeks_ago";

export type DspRawdataFilters = {
  dateBucket: DspDateBucket;
  distributor: string;
  adFormat: string;
  size: string;
  template: string;
};

export type RuntimeContext = {
  root: string;
  manifest: string;
  workflow: Workflow;
  template_version: string;
  rule_version: string;
  artifact_root: string;
};

export type ActionType = "bootstrap" | "health" | "save" | "modify" | "export" | "tab4_delivery";
export type FrontendActionType = ActionType | "publish";

export type RouteState = {
  workflow: Workflow;
  mainTab: MainTab;
  subTab: SubTab;
};

export type PeriodState = {
  preset: PeriodPreset;
  weekStart: string;
  weekEnd: string;
  label: string;
};

export type DirtyState = {
  rowCount: number;
  manualOverrideCount: number;
  hasDirty: boolean;
  lastTouchedAt: string;
};

export type ResultState = {
  lastAction: FrontendActionType | null;
  status: "idle" | "ok" | "error";
  errorCode: string;
  message: string;
  runId: string;
  updatedAt: string;
};

export type RuntimeEnvelope<T> = {
  status: "ok" | "error";
  result?: T;
  error_code?: string;
  message?: string;
  details?: Record<string, unknown>;
};

export type RuntimeStatusResult = {
  canonical_source: string;
  health: Record<string, unknown>;
  tab4_delivery?: {
    ready: boolean;
    reason: string;
    updated_at: string;
    last_delivery_run_id: string;
    last_change_run_id: string;
    delivery_snapshot_token?: string;
    delivery_row_count?: number;
    delivery_source_db_hash?: string;
    delivery_template_version?: string;
    delivery_rule_version?: string;
  };
  recent: {
    run_log: Array<Record<string, unknown>>;
    audit_log: Array<Record<string, unknown>>;
    publish_runs: Array<Record<string, unknown>>;
    evidence_index: Array<Record<string, unknown>>;
  };
};

export type RuntimeFrameResult = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  row_count: number;
  pivot_preview: Array<{ label: string; value: unknown }>;
  field_names?: string[];
  manual_fields?: string[];
  tab4_preview_template_summary?: Tab4TemplateSummary | null;
  tab4_preview_template_detail?: Tab4TemplateDetail | null;
  tab4_preview_contract?: {
    kind: string;
    note: string;
  };
  tab4_delivery_snapshot?: {
    delivery_snapshot_token: string;
    delivery_run_id: string;
    delivery_row_count: number;
    delivery_ready: boolean;
    delivery_reason: string;
  };
  frame_error?: string;
};

export type Tab4TemplateSummaryRow = {
  excelRow: number;
  monthlyAmounts: number[];
  monthlyRates: Array<number | null>;
  annualAmount: number;
  annualRate: number | null;
};

export type Tab4TemplateSummary = {
  source: string;
  year: number | null;
  monthTotals: number[];
  monthTotalRates: Array<number | null>;
  annualTotal: number;
  annualRate: number | null;
  rows: Tab4TemplateSummaryRow[];
};

export type Tab4TemplateDetailKpiRow = {
  excelRow: number;
  label: string;
  monthlyAmounts: number[];
  monthlyRates: Array<number | null>;
  annualAmount: number;
  annualRate: number | null;
};

export type Tab4TemplateDetailSectionTotal = {
  excelRow: number;
  labelA: string;
  labelB: string;
  labelC: string;
  labelD: string;
  monthlyAmounts: number[];
  monthlyRates: Array<number | null>;
  annualAmount: number;
  annualRate: number | null;
};

export type Tab4TemplateDetailSectionRow = {
  excelRow: number;
  labelA: string;
  labelB: string;
  labelC: string;
  labelD: string;
  monthlyAmounts: number[];
  monthlyRates: Array<number | null>;
  annualAmount: number;
  annualRate: number | null;
};

export type Tab4TemplateDetailSection = {
  id: string;
  year: number | null;
  monthLabels: string[];
  total: Tab4TemplateDetailSectionTotal;
  rows: Tab4TemplateDetailSectionRow[];
};

export type Tab4TemplateDetail = {
  source: string;
  monthLabels: string[];
  kpiRows: Tab4TemplateDetailKpiRow[];
  sections: Tab4TemplateDetailSection[];
};
