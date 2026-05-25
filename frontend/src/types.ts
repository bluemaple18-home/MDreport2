export type Workflow = "dsp" | "ssp" | "monthly";
export type MainTab = "dsp_tab3" | "dsp_tab4" | "ssp_anomaly" | "ssp_media_demand" | "ssp_ad_group" | "monthly_p4";
export type SubTab = "overview" | "rawdata" | "pivot" | "result";
export type SubView = "status" | "frame" | "result";
export type PeriodPreset =
  | "last_week"
  | "two_weeks_ago"
  | "three_weeks_ago"
  | "four_weeks_ago"
  | "current_week"
  | "current_month"
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
  | "monthly_p4_save"
  | "monthly_p4_test_save"
  | "monthly_p4_test_template_upload"
  | "monthly_p4_close"
  | "fetch_ssp_ad_group_api"
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
  ssp_ad_group_monitor?: SspAdGroupMonitorSnapshot;
  monthly_p4?: MonthlyP4Snapshot;
  monthly_p4_test?: MonthlyP4Snapshot;
  frame_error?: string;
};

export type MonthlyP4ManualInputDefinition = {
  key: string;
  label: string;
};

export type MonthlyP4MonthPayload = {
  month: string;
  dateRange: [string, string];
  targets: Record<string, number>;
  computed: Record<string, number>;
  manualInputs: Record<string, number>;
  actuals: Record<string, number>;
};

export type MonthlyP4TestTemplateMeta = {
  kind: string;
  filename: string;
  storedPath: string;
  fileSize: number;
  sheetNames: string[];
  snapshot?: {
    sheet?: string;
    entryCount?: number;
    warnings?: string[];
  };
  updatedAt: string;
};

export type MonthlyP4DiffItem = {
  key: string;
  reason?: "value_mismatch" | "missing_in_check_template" | "missing_in_candidate" | string;
  itemKey: string;
  metric: string;
  month: string;
  candidate: number | null;
  answer: number | null;
  delta: number | null;
  cell: string;
};

export type MonthlyP4Snapshot = {
  anchorMonth: string;
  months: string[];
  availableMonths?: string[];
  manualInputDefinitions: MonthlyP4ManualInputDefinition[];
  monthPayloads: MonthlyP4MonthPayload[];
  candidateSnapshot?: { entryCount?: number };
  diff?: { status: string; diffCount: number; diffs: MonthlyP4DiffItem[] };
  source: string;
  testDbPath?: string;
  testTemplates?: Record<string, MonthlyP4TestTemplateMeta>;
  note: string;
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

export type SspAdGroupMetricSummary = {
  zone_group_id?: number;
  zone_group_name?: string;
  ad_format?: string;
  price_tier?: string;
  zone_id?: number;
  zone_name?: string;
  date?: string;
  request: number;
  impress: number;
  click: number;
  ctr: number;
  ecpm: number;
  ecpc: number;
  profit: number;
  advertiser_mu: number;
  dsp_cpm: number;
  dsp_cpc: number;
  invalid_impress?: number;
  invalid_click?: number;
  status?: "ok" | "alert";
  reasons?: string[];
  latest_run?: Record<string, unknown> | null;
  avg_metrics?: Record<string, number>;
  daily_metrics?: Record<string, SspAdGroupMetricSummary>;
};

export type SspAdGroupAnomaly = {
  zone_id: number;
  zone_name: string;
  request: number;
  impress: number;
  click: number;
  ctr: number;
  ecpm: number;
  ecpc: number;
  reasons: string[];
};

export type SspAdGroupMonitorSnapshot = {
  start_day: string;
  end_day: string;
  catalog: Array<{ id: number; name: string; format: string; tier: string }>;
  formats: string[];
  metrics: string[];
  default_metric: string;
  summary: SspAdGroupMetricSummary;
  groups: SspAdGroupMetricSummary[];
  format_summary: SspAdGroupMetricSummary[];
  placements_by_group: Record<string, SspAdGroupMetricSummary[]>;
  date_keys_desc: string[];
  latest_runs: Array<Record<string, unknown>>;
  row_count: number;
  group_count: number;
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
