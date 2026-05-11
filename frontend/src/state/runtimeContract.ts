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
  manifest: "manifest",
  workflow: "workflow",
  templateVersion: "template_version",
  ruleVersion: "rule_version",
  artifactRoot: "artifact_root",
  mainTab: "main_tab",
  subTab: "sub_tab",
  periodPreset: "period_preset",
  periodWeekStart: "period_week_start",
  periodWeekEnd: "period_week_end",
  rowFilter: "row_filter",
  rowLimit: "row_limit",
} as const;

export const ACCEPTANCE_SELECTORS = {
  workflowSwitch: "workflow-switch",
  workflowUseDsp: "workflow-use-dsp",
  workflowUseSsp: "workflow-use-ssp",
  mainTabs: "main-tabs",
  mainTabDspTab3: "main-tab-dsp-tab3",
  mainTabDspTab4: "main-tab-dsp-tab4",
  mainTabSspAnomaly: "main-tab-ssp-anomaly",
  subTabs: "sub-tabs",
  subTabOverview: "sub-tab-overview",
  subTabRawdata: "sub-tab-rawdata",
  subTabPivot: "sub-tab-pivot",
  subTabResult: "sub-tab-result",
  periodSelector: "period-selector",
  periodPreset: "period-preset",
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

export const defaultRuntimeContext: RuntimeContext = {
  root: ".",
  manifest: "bootstrap.manifest.json",
  workflow: "dsp",
  template_version: "v1",
  rule_version: "v1",
  artifact_root: "artifacts",
};

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
  const current = thisWeekRange();
  const start = new Date(current.weekStart);
  start.setDate(start.getDate() - 7);
  const end = new Date(current.weekEnd);
  end.setDate(end.getDate() - 7);
  return {
    weekStart: toDateIso(start),
    weekEnd: toDateIso(end),
  };
}

export function buildDefaultPeriodState(): PeriodState {
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
  return raw === "current_week" || raw === "last_week" || raw === "custom" ? raw : null;
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
  const range = preset === "current_week" ? thisWeekRange() : lastWeekRange();
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
    return [{ value: "ssp_anomaly", label: "成效異常" }];
  }
  return [
    { value: "dsp_tab3", label: "Tab3 資料層" },
    { value: "dsp_tab4", label: "Tab4 報表層" },
  ];
}

export function getSubTabOptions(mainTab: MainTab): Array<{ value: SubTab; label: string }> {
  if (mainTab === "ssp_anomaly") {
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
  const workflow = parseWorkflow(params.get(QUERY_KEYS.workflow))
    || parseWorkflow(sessionParsed.route?.workflow || null)
    || defaultRouteState.workflow;
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
  const periodPreset = parsePeriodPreset(params.get(QUERY_KEYS.periodPreset))
    || parsePeriodPreset(sessionParsed.period?.preset || null)
    || fallbackPeriod.preset;

  const weekStart = params.get(QUERY_KEYS.periodWeekStart)
    || sessionParsed.period?.weekStart
    || fallbackPeriod.weekStart;
  const weekEnd = params.get(QUERY_KEYS.periodWeekEnd)
    || sessionParsed.period?.weekEnd
    || fallbackPeriod.weekEnd;

  const currentPeriod = applyPreset(periodPreset, {
    preset: "custom",
    weekStart,
    weekEnd,
    label: buildPeriodLabel(weekStart, weekEnd),
  });

  const ctx: RuntimeContext = {
    root: params.get(QUERY_KEYS.root) || sessionParsed.ctx?.root || defaultRuntimeContext.root,
    manifest: params.get(QUERY_KEYS.manifest) || sessionParsed.ctx?.manifest || defaultRuntimeContext.manifest,
    workflow,
    template_version:
      params.get(QUERY_KEYS.templateVersion)
      || sessionParsed.ctx?.template_version
      || defaultRuntimeContext.template_version,
    rule_version:
      params.get(QUERY_KEYS.ruleVersion) || sessionParsed.ctx?.rule_version || defaultRuntimeContext.rule_version,
    artifact_root:
      params.get(QUERY_KEYS.artifactRoot)
      || sessionParsed.ctx?.artifact_root
      || defaultRuntimeContext.artifact_root,
  };

  const queryRowLimitRaw = params.get(QUERY_KEYS.rowLimit);
  const queryRowLimit = queryRowLimitRaw ? Number.parseInt(queryRowLimitRaw, 10) : NaN;
  const rowLimit = Number.isFinite(queryRowLimit) && queryRowLimit > 0
    ? queryRowLimit
    : (sessionParsed.rowLimit && sessionParsed.rowLimit > 0 ? sessionParsed.rowLimit : 50);

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
  params.set(QUERY_KEYS.manifest, state.ctx.manifest);
  params.set(QUERY_KEYS.workflow, state.route.workflow);
  params.set(QUERY_KEYS.templateVersion, state.ctx.template_version);
  params.set(QUERY_KEYS.ruleVersion, state.ctx.rule_version);
  params.set(QUERY_KEYS.artifactRoot, state.ctx.artifact_root);
  params.set(QUERY_KEYS.mainTab, state.route.mainTab);
  if (state.route.mainTab === "ssp_anomaly") {
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

export function updatePeriodWindow(current: PeriodState, weekStart: string, weekEnd: string): PeriodState {
  return {
    preset: "custom",
    weekStart,
    weekEnd,
    label: buildPeriodLabel(weekStart, weekEnd),
  };
}
