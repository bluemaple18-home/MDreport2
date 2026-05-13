import type {
  DirtyState,
  DspRawdataFilters,
  MainTab,
  PeriodPreset,
  PeriodState,
  ResultState,
  RouteState,
  RuntimeContext,
  SubTab,
  Workflow,
} from "../types";
import { defaultDspRawdataFilters } from "../shell/dspRawdataFilters";

export const FRONTEND_SESSION_KEY = "mdrep.frontend.contract.v1";

export const QUERY_KEYS = {
  root: "root",
  env: "env",
  manifest: "manifest",
  workflow: "workflow",
  templateVersion: "template_version",
  ruleVersion: "rule_version",
  artifactRoot: "artifact_root",
  sandbox: "sandbox",
  mainTab: "main_tab",
  subTab: "sub_tab",
  periodPreset: "period_preset",
  periodWeekStart: "period_week_start",
  periodWeekEnd: "period_week_end",
  rowFilter: "row_filter",
  rowLimit: "row_limit",
} as const;

export const ALLOWED_ROW_LIMITS = [10, 20, 50, 100, 200] as const;
export const DEFAULT_ROW_LIMIT = 10;

export function normalizeRowLimit(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return ALLOWED_ROW_LIMITS.includes(parsed as (typeof ALLOWED_ROW_LIMITS)[number]) ? parsed : DEFAULT_ROW_LIMIT;
}

export const ACCEPTANCE_SELECTORS = {
  workflowSwitch: "workflow-switch",
  workflowUseDsp: "workflow-use-dsp",
  workflowUseSsp: "workflow-use-ssp",
  mainTabs: "main-tabs",
  mainTabDspTab3: "main-tab-dsp-tab3",
  mainTabDspTab4: "main-tab-dsp-tab4",
  mainTabSspAnomaly: "main-tab-ssp-anomaly",
  mainTabSspMediaDemand: "main-tab-ssp-media-demand",
  subTabs: "sub-tabs",
  subTabOverview: "sub-tab-overview",
  subTabRawdata: "sub-tab-rawdata",
  subTabPivot: "sub-tab-pivot",
  subTabResult: "sub-tab-result",
  periodSelector: "period-selector",
  periodPreset: "period-preset",
  periodRangeToggle: "period-range-toggle",
  periodRangePopover: "period-range-popover",
  periodWeekStart: "period-week-start",
  periodWeekEnd: "period-week-end",
  dirtyCounter: "dirty-counter",
  actionSave: "action-save",
  actionModify: "action-modify",
  actionPublish: "action-publish",
  actionExport: "action-export",
  sectionRawdata: "section-rawdata",
  sectionPivot: "section-pivot",
  sectionResult: "section-result",
} as const;

type Tab4DeliveryLike = {
  ready?: boolean;
  reason?: string;
  delivery_snapshot_token?: string;
  last_delivery_run_id?: string;
  delivery_week_start?: string;
  delivery_week_end?: string;
};

export function resolveTab4DeliveryReadiness(
  delivery: Tab4DeliveryLike | null | undefined,
  period: Pick<PeriodState, "weekStart" | "weekEnd">,
): { ready: boolean; reason: string; snapshotToken: string; deliveryRunId: string } {
  if (!delivery) {
    return { ready: false, reason: "", snapshotToken: "", deliveryRunId: "" };
  }
  let ready = Boolean(delivery.ready);
  let reason = String(delivery.reason || "");
  const deliveryWeekStart = String(delivery.delivery_week_start || "").trim();
  const deliveryWeekEnd = String(delivery.delivery_week_end || "").trim();
  if (
    ready
    && deliveryWeekStart
    && deliveryWeekEnd
    && (deliveryWeekStart !== period.weekStart || deliveryWeekEnd !== period.weekEnd)
  ) {
    ready = false;
    reason = "period_mismatch";
  }
  return {
    ready,
    reason,
    snapshotToken: String(delivery.delivery_snapshot_token || ""),
    deliveryRunId: String(delivery.last_delivery_run_id || ""),
  };
}

export const defaultRuntimeContext: RuntimeContext = {
  root: ".",
  env: "prod",
  manifest: "bootstrap.manifest.json",
  workflow: "dsp",
  template_version: "v1",
  rule_version: "v1",
  artifact_root: "artifacts",
  sandbox: "",
};

function normalizeSandboxId(raw: string | null | undefined): string {
  const value = String(raw || "").trim();
  return value;
}

function defaultManifestByEnv(env: string): string {
  return env === "test" ? "bootstrap.test.manifest.json" : "bootstrap.manifest.json";
}

function defaultArtifactRootByEnv(env: string): string {
  return env === "test" ? "artifacts_test" : "artifacts";
}

function parseRuntimeEnv(raw: string | null): RuntimeContext["env"] | null {
  return raw === "prod" || raw === "test" ? raw : null;
}

export const defaultRouteState: RouteState = {
  workflow: "dsp",
  mainTab: "dsp_tab3",
  subTab: "rawdata",
};

export const defaultDirtyState: DirtyState = {
  rowCount: 0,
  manualOverrideCount: 0,
  hasDirty: false,
  lastTouchedAt: "",
};

export const defaultResultState: ResultState = {
  lastAction: null,
  status: "idle",
  errorCode: "",
  message: "",
  runId: "",
  updatedAt: "",
};

function toDateIso(value: Date): string {
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  const dd = String(value.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function thisWeekRange(): { weekStart: string; weekEnd: string } {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setDate(now.getDate() + mondayOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    weekStart: toDateIso(start),
    weekEnd: toDateIso(end),
  };
}

function lastWeekRange(): { weekStart: string; weekEnd: string } {
  return weekRangeByOffset(1);
}

function weekRangeByOffset(weeksAgo: number): { weekStart: string; weekEnd: string } {
  const current = thisWeekRange();
  const start = new Date(current.weekStart);
  start.setDate(start.getDate() - weeksAgo * 7);
  const end = new Date(current.weekEnd);
  end.setDate(end.getDate() - weeksAgo * 7);
  return {
    weekStart: toDateIso(start),
    weekEnd: toDateIso(end),
  };
}

function lastNDaysRange(days: number): { weekStart: string; weekEnd: string } {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - (days - 1));
  return {
    weekStart: toDateIso(start),
    weekEnd: toDateIso(end),
  };
}

export function buildDefaultPeriodState(workflow: Workflow = "dsp"): PeriodState {
  if (workflow === "ssp") {
    const range = lastNDaysRange(7);
    return {
      preset: "last_7_days",
      weekStart: range.weekStart,
      weekEnd: range.weekEnd,
      label: `${range.weekStart} ~ ${range.weekEnd}`,
    };
  }
  const range = lastWeekRange();
  return {
    preset: "last_week",
    weekStart: range.weekStart,
    weekEnd: range.weekEnd,
    label: `${range.weekStart} ~ ${range.weekEnd}`,
  };
}

function parseWorkflow(raw: string | null): Workflow | null {
  return raw === "dsp" || raw === "ssp" ? raw : null;
}

function parseMainTab(raw: string | null): MainTab | null {
  if (
    raw === "dsp_tab3"
    || raw === "dsp_tab4"
    || raw === "ssp_anomaly"
    || raw === "ssp_media_demand"
  ) {
    return raw;
  }
  return null;
}

function parseSubTab(raw: string | null): SubTab | null {
  if (raw === "overview" || raw === "rawdata" || raw === "pivot" || raw === "result") {
    return raw;
  }
  return null;
}

function parsePeriodPreset(raw: string | null): PeriodPreset | null {
  return raw === "last_week"
    || raw === "two_weeks_ago"
    || raw === "three_weeks_ago"
    || raw === "four_weeks_ago"
    || raw === "current_week"
    || raw === "last_7_days"
    || raw === "last_14_days"
    || raw === "custom" ? raw : null;
}

function normalizePeriodPresetByWorkflow(workflow: Workflow, preset: PeriodPreset | null, fallback: PeriodPreset): PeriodPreset {
  if (workflow === "ssp") {
    return preset === "custom" || preset === "last_7_days" || preset === "last_14_days" ? preset : fallback;
  }
  return preset === "last_week"
    || preset === "two_weeks_ago"
    || preset === "three_weeks_ago"
    || preset === "four_weeks_ago" ? preset : fallback;
}

function buildPeriodLabel(weekStart: string, weekEnd: string): string {
  const start = weekStart.trim();
  const end = weekEnd.trim();
  if (!start || !end) {
    return "";
  }
  return `${start} ~ ${end}`;
}

function applyPreset(preset: PeriodPreset, fallback: PeriodState): PeriodState {
  if (preset === "custom") {
    return {
      ...fallback,
      preset,
      label: buildPeriodLabel(fallback.weekStart, fallback.weekEnd),
    };
  }
  if (preset === "last_14_days") {
    const range = lastNDaysRange(14);
    return {
      preset,
      weekStart: range.weekStart,
      weekEnd: range.weekEnd,
      label: buildPeriodLabel(range.weekStart, range.weekEnd),
    };
  }
  if (preset === "last_7_days") {
    const range = lastNDaysRange(7);
    return {
      preset,
      weekStart: range.weekStart,
      weekEnd: range.weekEnd,
      label: buildPeriodLabel(range.weekStart, range.weekEnd),
    };
  }
  const dspWeekOffsets: Partial<Record<PeriodPreset, number>> = {
    last_week: 1,
    two_weeks_ago: 2,
    three_weeks_ago: 3,
    four_weeks_ago: 4,
  };
  const range = preset === "current_week"
    ? thisWeekRange()
    : weekRangeByOffset(dspWeekOffsets[preset] || 1);
  return {
    preset,
    weekStart: range.weekStart,
    weekEnd: range.weekEnd,
    label: buildPeriodLabel(range.weekStart, range.weekEnd),
  };
}

type PersistedState = {
  ctx: RuntimeContext;
  route: RouteState;
  period: PeriodState;
  rowFilter: string;
  rowLimit: number;
  dspRawdataFilters: DspRawdataFilters;
};

export function getMainTabOptions(workflow: Workflow): Array<{ value: MainTab; label: string }> {
  if (workflow === "ssp") {
    return [
      { value: "ssp_anomaly", label: "成效救火" },
      { value: "ssp_media_demand", label: "媒體要量" },
    ];
  }
  return [
    { value: "dsp_tab3", label: "Tab3 資料層" },
    { value: "dsp_tab4", label: "Tab4 報表層" },
  ];
}

export function getSubTabOptions(mainTab: MainTab): Array<{ value: SubTab; label: string }> {
  if (mainTab === "ssp_anomaly" || mainTab === "ssp_media_demand") {
    return [];
  }
  if (mainTab === "dsp_tab4") {
    return [
      { value: "overview", label: "Overview" },
      { value: "result", label: "Result" },
    ];
  }
  return [
    { value: "overview", label: "Overview" },
    { value: "rawdata", label: "Rawdata" },
    { value: "pivot", label: "樞紐" },
    { value: "result", label: "Result" },
  ];
}

export function defaultMainTabByWorkflow(workflow: Workflow): MainTab {
  return workflow === "ssp" ? "ssp_anomaly" : "dsp_tab3";
}

export function isMainTabForWorkflow(workflow: Workflow, mainTab: MainTab): boolean {
  const values = getMainTabOptions(workflow).map((item) => item.value);
  return values.includes(mainTab);
}

export function normalizeSubTabByMainTab(mainTab: MainTab, subTab: SubTab): SubTab {
  const values = getSubTabOptions(mainTab).map((item) => item.value);
  if (values.length === 0) {
    return "overview";
  }
  if (values.includes(subTab)) {
    return subTab;
  }
  return values[0] || "overview";
}

export function restorePersistedState(): PersistedState {
  const fallbackPeriod = buildDefaultPeriodState();
  let sessionParsed: Partial<PersistedState> = {};
  try {
    const raw = sessionStorage.getItem(FRONTEND_SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (parsed && typeof parsed === "object") {
        sessionParsed = parsed;
      }
    }
  } catch {
    sessionParsed = {};
  }

  const params = new URLSearchParams(window.location.search);
  const queryRuntimeEnv = parseRuntimeEnv(params.get(QUERY_KEYS.env));
  const runtimeEnv = queryRuntimeEnv
    || parseRuntimeEnv(sessionParsed.ctx?.env || null)
    || defaultRuntimeContext.env;
  const queryManifest = params.get(QUERY_KEYS.manifest);
  const queryArtifactRoot = params.get(QUERY_KEYS.artifactRoot);
  const forceEnvDefaults = queryRuntimeEnv !== null;
  const workflow = parseWorkflow(params.get(QUERY_KEYS.workflow))
    || parseWorkflow(sessionParsed.route?.workflow || null)
    || defaultRouteState.workflow;
  const workflowFallbackPeriod = buildDefaultPeriodState(workflow);
  let mainTab = parseMainTab(params.get(QUERY_KEYS.mainTab))
    || parseMainTab(sessionParsed.route?.mainTab || null)
    || defaultMainTabByWorkflow(workflow);
  if (!isMainTabForWorkflow(workflow, mainTab)) {
    mainTab = defaultMainTabByWorkflow(workflow);
  }
  const restoredSubTab = parseSubTab(params.get(QUERY_KEYS.subTab))
    || parseSubTab(sessionParsed.route?.subTab || null)
    || defaultRouteState.subTab;
  const subTab = normalizeSubTabByMainTab(mainTab, restoredSubTab);
  const periodPreset = normalizePeriodPresetByWorkflow(
    workflow,
    parsePeriodPreset(params.get(QUERY_KEYS.periodPreset))
      || parsePeriodPreset(sessionParsed.period?.preset || null),
    workflowFallbackPeriod.preset,
  );

  const weekStart = params.get(QUERY_KEYS.periodWeekStart)
    || sessionParsed.period?.weekStart
    || workflowFallbackPeriod.weekStart;
  const weekEnd = params.get(QUERY_KEYS.periodWeekEnd)
    || sessionParsed.period?.weekEnd
    || workflowFallbackPeriod.weekEnd;

  const currentPeriod = applyPreset(periodPreset, {
    preset: "custom",
    weekStart,
    weekEnd,
    label: buildPeriodLabel(weekStart, weekEnd),
  });

  const ctx: RuntimeContext = {
    root: params.get(QUERY_KEYS.root) || sessionParsed.ctx?.root || defaultRuntimeContext.root,
    env: runtimeEnv,
    manifest:
      queryManifest
      || (forceEnvDefaults ? defaultManifestByEnv(runtimeEnv) : sessionParsed.ctx?.manifest)
      || defaultManifestByEnv(runtimeEnv),
    workflow,
    template_version:
      params.get(QUERY_KEYS.templateVersion)
      || sessionParsed.ctx?.template_version
      || defaultRuntimeContext.template_version,
    rule_version:
      params.get(QUERY_KEYS.ruleVersion) || sessionParsed.ctx?.rule_version || defaultRuntimeContext.rule_version,
    artifact_root:
      queryArtifactRoot
      || (forceEnvDefaults ? defaultArtifactRootByEnv(runtimeEnv) : sessionParsed.ctx?.artifact_root)
      || defaultArtifactRootByEnv(runtimeEnv),
    sandbox: normalizeSandboxId(params.get(QUERY_KEYS.sandbox) || sessionParsed.ctx?.sandbox || ""),
  };

  const queryRowLimitRaw = params.get(QUERY_KEYS.rowLimit);
  const rowLimit = queryRowLimitRaw ? normalizeRowLimit(queryRowLimitRaw) : normalizeRowLimit(sessionParsed.rowLimit);

  return {
    ctx,
    route: {
      workflow,
      mainTab,
      subTab,
    },
    period: currentPeriod,
    rowFilter: params.get(QUERY_KEYS.rowFilter) ?? sessionParsed.rowFilter ?? "",
    rowLimit,
    dspRawdataFilters: sessionParsed.dspRawdataFilters ?? defaultDspRawdataFilters,
  };
}

export function persistState(state: PersistedState): void {
  sessionStorage.setItem(FRONTEND_SESSION_KEY, JSON.stringify(state));

  const params = new URLSearchParams(window.location.search);
  params.set(QUERY_KEYS.root, state.ctx.root);
  params.set(QUERY_KEYS.env, state.ctx.env);
  params.set(QUERY_KEYS.manifest, state.ctx.manifest);
  params.set(QUERY_KEYS.workflow, state.route.workflow);
  params.set(QUERY_KEYS.templateVersion, state.ctx.template_version);
  params.set(QUERY_KEYS.ruleVersion, state.ctx.rule_version);
  params.set(QUERY_KEYS.artifactRoot, state.ctx.artifact_root);
  if (state.ctx.sandbox) {
    params.set(QUERY_KEYS.sandbox, state.ctx.sandbox);
  } else {
    params.delete(QUERY_KEYS.sandbox);
  }
  params.set(QUERY_KEYS.mainTab, state.route.mainTab);
  if (getSubTabOptions(state.route.mainTab).length === 0) {
    params.delete(QUERY_KEYS.subTab);
  } else {
    params.set(QUERY_KEYS.subTab, state.route.subTab);
  }
  params.set(QUERY_KEYS.periodPreset, state.period.preset);
  params.set(QUERY_KEYS.periodWeekStart, state.period.weekStart);
  params.set(QUERY_KEYS.periodWeekEnd, state.period.weekEnd);
  params.set(QUERY_KEYS.rowFilter, state.rowFilter);
  params.set(QUERY_KEYS.rowLimit, String(state.rowLimit));
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
  window.history.replaceState(null, "", nextUrl);
}

export function updatePeriodPreset(current: PeriodState, preset: PeriodPreset): PeriodState {
  return applyPreset(preset, current);
}

export function defaultPeriodStateByWorkflow(workflow: Workflow): PeriodState {
  return buildDefaultPeriodState(workflow);
}

export function updatePeriodWindow(current: PeriodState, weekStart: string, weekEnd: string): PeriodState {
  return {
    preset: "custom",
    weekStart,
    weekEnd,
    label: buildPeriodLabel(weekStart, weekEnd),
  };
}
