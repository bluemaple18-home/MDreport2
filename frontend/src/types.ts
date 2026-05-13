export type Workflow = "dsp" | "ssp";
export type MainTab = "dsp_tab3" | "dsp_tab4" | "ssp_anomaly" | "ssp_media_demand";
export type SubTab = "overview" | "rawdata" | "pivot" | "result";
export type SubView = "status" | "frame" | "result";
export type PeriodPreset =
  | "last_week"
  | "two_weeks_ago"
  | "three_weeks_ago"
  | "four_weeks_ago"
  | "current_week"
  | "last_7_days"
  | "last_14_days"
  | "custom";
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
  env: string;
  manifest: string;
  workflow: Workflow;
  template_version: string;
  rule_version: string;
  artifact_root: string;
  sandbox: string;
};

export type ActionType =
  | "bootstrap"
  | "health"
  | "save"
  | "modify"
  | "export"
  | "tab4_delivery"
  | "ssp_media_save"
  | "sandbox_prepare"
  | "sandbox_reset";
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
  sandbox?: {
    id: string;
    enabled: boolean;
    db_path: string;
    baseline_db_path: string;
  };
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
    delivery_week_start?: string;
    delivery_week_end?: string;
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
  sandbox?: {
    id: string;
    enabled: boolean;
    db_path: string;
    baseline_db_path: string;
  };
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
    delivery_week_start?: string;
    delivery_week_end?: string;
  };
  ssp_media_demand?: SspMediaDemandConfig;
  frame_error?: string;
};

export type SspMediaDemandSlot = {
  id?: number;
  runtime_env?: string;
  category: string;
  slot_order: number;
  placement_id: string;
  placement_name: string;
  media_quality?: string;
  need_call?: boolean;
  target_fr?: string;
  remark: string;
  media_target: number;
  is_active: boolean;
};

export type SspMediaDemandConfig = {
  runtime_env: string;
  categories: string[];
  slots: SspMediaDemandSlot[];
  defaults_source: string;
  template_path: string;
  group_overrides_path: string;
  storage_source: string;
};

export type SspMediaDemandMetricSet = {
  complianceRate: number;
  request: number;
  impression: number;
  clicks: number;
  revenue: number;
  dspAmount: number;
  fr: number;
  ctr: number;
  ecpm: number;
};

export type SspMediaDemandViewRow = {
  slot: SspMediaDemandSlot;
  latest_request: number;
  latest_compliance_rate: number;
  has_latest_date_data: boolean;
  metrics_by_date: Record<string, Record<"all" | "07-22", SspMediaDemandMetricSet>>;
};

export type SspMediaDemandView = {
  category: string;
  source: string;
  scope_mode: "all" | "07-22";
  day_limit: number;
  threshold: number;
  only_unmet: boolean;
  date_keys: string[];
  latest_date: string;
  latest_total_request: number;
  unmet_count: number;
  source_options: string[];
  rows: SspMediaDemandViewRow[];
};

export type SspMediaDemandResponse = {
  config: SspMediaDemandConfig;
  view: SspMediaDemandView;
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
