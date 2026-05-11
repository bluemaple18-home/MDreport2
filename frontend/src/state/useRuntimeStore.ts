import { useCallback, useEffect, useReducer } from "react";
import { fetchFrame, fetchStatus, postAction } from "../api/runtimeApi";
import type { ActionPayload } from "../api/runtimeApi";
import type {
  DirtyState,
  FrontendActionType,
  DspRawdataFilters,
  PeriodPreset,
  PeriodState,
  ResultState,
  RouteState,
  RuntimeContext,
  RuntimeEnvelope,
  RuntimeFrameResult,
  RuntimeStatusResult,
  SubTab,
  Workflow,
} from "../types";
import {
  defaultMainTabByWorkflow,
  defaultDirtyState,
  defaultResultState,
  normalizeSubTabByMainTab,
  persistState,
  restorePersistedState,
  updatePeriodPreset,
  updatePeriodWindow,
} from "./runtimeContract";

type RuntimeState = {
  ctx: RuntimeContext;
  route: RouteState;
  period: PeriodState;
  dirtyState: DirtyState;
  resultState: ResultState;
  rowFilter: string;
  rowLimit: number;
  dspRawdataFilters: DspRawdataFilters;
  rowsJson: string;
  updatesJson: string;
  busy: boolean;
  statusPayload: RuntimeEnvelope<RuntimeStatusResult> | null;
  framePayload: RuntimeEnvelope<RuntimeFrameResult> | null;
  resultPayload: RuntimeEnvelope<Record<string, unknown>> | null;
  tab4DeliveryReady: boolean;
  tab4DeliveryUpdatedAt: string;
  tab4DeliveryReason: string;
  tab4DeliverySnapshotToken: string;
  tab4DeliveryRunId: string;
};

type ActionRouteOverride = {
  mainTab?: RouteState["mainTab"];
  subTab?: RouteState["subTab"];
};

type RuntimeAction =
  | { type: "set_ctx"; key: keyof RuntimeContext; value: string }
  | { type: "set_workflow"; value: Workflow }
  | { type: "set_main_tab"; value: RouteState["mainTab"] }
  | { type: "set_subtab"; value: SubTab }
  | { type: "set_period_preset"; value: PeriodPreset }
  | { type: "set_period_window"; weekStart: string; weekEnd: string }
  | { type: "set_row_filter"; value: string }
  | { type: "set_row_limit"; value: number }
  | { type: "set_dsp_rawdata_filters"; value: DspRawdataFilters }
  | { type: "set_rows_json"; value: string }
  | { type: "set_updates_json"; value: string }
  | { type: "set_dirty_state"; value: DirtyState }
  | { type: "set_result_state"; value: ResultState }
  | { type: "busy"; value: boolean }
  | { type: "set_status"; payload: RuntimeEnvelope<RuntimeStatusResult> }
  | { type: "set_frame"; payload: RuntimeEnvelope<RuntimeFrameResult> }
  | { type: "set_result"; payload: RuntimeEnvelope<Record<string, unknown>> }
  | { type: "set_tab4_delivery_ready"; value: boolean; reason?: string; snapshotToken?: string; deliveryRunId?: string };

function parseJsonArray(text: string, fieldName: "rows" | "updates"): Array<Record<string, unknown>> {
  const parsed = JSON.parse(text || "[]");
  if (!Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be json array`);
  }
  return parsed.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${fieldName} item must be json object`);
    }
    return item as Record<string, unknown>;
  });
}

function safeArrayLength(text: string): number {
  try {
    return parseJsonArray(text, "updates").length;
  } catch {
    return 0;
  }
}

function deriveDirtyState(base: DirtyState, updatesJson: string): DirtyState {
  const rowCount = safeArrayLength(updatesJson);
  const hasDirty = rowCount > 0;
  return {
    ...base,
    rowCount,
    manualOverrideCount: rowCount,
    hasDirty,
    lastTouchedAt: hasDirty ? new Date().toISOString() : "",
  };
}

function deriveResultState(
  current: ResultState,
  action: FrontendActionType,
  payload: RuntimeEnvelope<Record<string, unknown>>,
): ResultState {
  const runId = payload.result && typeof payload.result === "object"
    ? String((payload.result as Record<string, unknown>).run_id || "")
    : "";
  const message = payload.message || (payload.status === "ok" ? "ok" : "error");
  return {
    lastAction: action,
    status: payload.status,
    errorCode: payload.error_code || "",
    message,
    runId,
    updatedAt: new Date().toISOString(),
  };
}

function reducer(state: RuntimeState, action: RuntimeAction): RuntimeState {
  switch (action.type) {
    case "set_ctx":
      return { ...state, ctx: { ...state.ctx, [action.key]: action.value } };
    case "set_workflow":
      {
        const nextMainTab = defaultMainTabByWorkflow(action.value);
        const nextSubTab = normalizeSubTabByMainTab(nextMainTab, state.route.subTab);
        return {
          ...state,
          ctx: { ...state.ctx, workflow: action.value },
          route: { workflow: action.value, mainTab: nextMainTab, subTab: nextSubTab },
        };
      }
    case "set_main_tab":
      {
        const nextSubTab = normalizeSubTabByMainTab(action.value, state.route.subTab);
        return {
          ...state,
          route: {
            ...state.route,
            mainTab: action.value,
            subTab: nextSubTab,
          },
        };
      }
    case "set_subtab":
      return {
        ...state,
        route: { ...state.route, subTab: normalizeSubTabByMainTab(state.route.mainTab, action.value) },
      };
    case "set_period_preset":
      return { ...state, period: updatePeriodPreset(state.period, action.value) };
    case "set_period_window":
      return { ...state, period: updatePeriodWindow(state.period, action.weekStart, action.weekEnd) };
    case "set_row_filter":
      return { ...state, rowFilter: action.value };
    case "set_row_limit":
      return { ...state, rowLimit: action.value };
    case "set_dsp_rawdata_filters":
      return { ...state, dspRawdataFilters: action.value };
    case "set_rows_json":
      return { ...state, rowsJson: action.value };
    case "set_updates_json":
      return {
        ...state,
        updatesJson: action.value,
        dirtyState: deriveDirtyState(state.dirtyState, action.value),
      };
    case "set_dirty_state":
      return { ...state, dirtyState: action.value };
    case "set_result_state":
      return { ...state, resultState: action.value };
    case "busy":
      return { ...state, busy: action.value };
    case "set_status":
      return { ...state, statusPayload: action.payload };
    case "set_frame":
      return { ...state, framePayload: action.payload };
    case "set_result":
      return { ...state, resultPayload: action.payload };
    case "set_tab4_delivery_ready":
      return {
        ...state,
        tab4DeliveryReady: action.value,
        tab4DeliveryReason: action.reason || "",
        tab4DeliveryUpdatedAt: new Date().toISOString(),
        tab4DeliverySnapshotToken: action.snapshotToken || "",
        tab4DeliveryRunId: action.deliveryRunId || "",
      };
    default:
      return state;
  }
}

export function useRuntimeStore() {
  const restored = restorePersistedState();
  const [state, dispatch] = useReducer(reducer, {
    ctx: restored.ctx,
    route: restored.route,
    period: restored.period,
    dirtyState: defaultDirtyState,
    resultState: defaultResultState,
    rowFilter: restored.rowFilter,
    rowLimit: restored.rowLimit,
    dspRawdataFilters: restored.dspRawdataFilters,
    rowsJson: "[]",
    updatesJson: "[]",
    busy: false,
    statusPayload: null,
    framePayload: null,
    resultPayload: null,
    tab4DeliveryReady: false,
    tab4DeliveryUpdatedAt: "",
    tab4DeliveryReason: "",
    tab4DeliverySnapshotToken: "",
    tab4DeliveryRunId: "",
  });

  useEffect(() => {
    persistState({
      ctx: state.ctx,
      route: state.route,
      period: state.period,
      rowFilter: state.rowFilter,
      rowLimit: state.rowLimit,
      dspRawdataFilters: state.dspRawdataFilters,
    });
  }, [state.ctx, state.route, state.period, state.rowFilter, state.rowLimit, state.dspRawdataFilters]);

  const syncTab4DeliveryState = useCallback(
    (payload: RuntimeEnvelope<RuntimeStatusResult>) => {
      const delivery = payload.result?.tab4_delivery;
      if (!delivery) {
        return;
      }
      dispatch({
        type: "set_tab4_delivery_ready",
        value: Boolean(delivery.ready),
        reason: String(delivery.reason || ""),
        snapshotToken: String(delivery.delivery_snapshot_token || ""),
        deliveryRunId: String(delivery.last_delivery_run_id || ""),
      });
    },
    [dispatch],
  );

  const refreshRuntime = useCallback(async () => {
    dispatch({ type: "busy", value: true });
    try {
      const [statusPayload, framePayload] = await Promise.all([
        fetchStatus(state.ctx),
        fetchFrame(state.ctx),
      ]);
      dispatch({ type: "set_status", payload: statusPayload });
      syncTab4DeliveryState(statusPayload);
      dispatch({ type: "set_frame", payload: framePayload });
    } finally {
      dispatch({ type: "busy", value: false });
    }
  }, [state.ctx, syncTab4DeliveryState]);

  const refreshStatus = useCallback(async () => {
    dispatch({ type: "busy", value: true });
    try {
      const payload = await fetchStatus(state.ctx);
      dispatch({ type: "set_status", payload });
      syncTab4DeliveryState(payload);
    } finally {
      dispatch({ type: "busy", value: false });
    }
  }, [state.ctx, syncTab4DeliveryState]);

  const refreshFrame = useCallback(async () => {
    dispatch({ type: "busy", value: true });
    try {
      const payload = await fetchFrame(state.ctx);
      dispatch({ type: "set_frame", payload });
    } finally {
      dispatch({ type: "busy", value: false });
    }
  }, [state.ctx]);

  const runActionWithResult = useCallback(
    async (
      action: ActionPayload["action"],
      overrides?: {
        rows?: Array<Record<string, unknown>>;
        updates?: Array<Record<string, unknown>>;
        route?: ActionRouteOverride;
      },
    ): Promise<RuntimeEnvelope<Record<string, unknown>>> => {
      dispatch({ type: "busy", value: true });
      try {
        const effectiveMainTab = overrides?.route?.mainTab ?? state.route.mainTab;
        const effectiveSubTab = overrides?.route?.subTab ?? state.route.subTab;
        const payload: ActionPayload = {
          action,
          main_tab: effectiveMainTab,
          sub_tab: effectiveSubTab,
        };
        payload.period_preset = state.period.preset;
        payload.period_week_start = state.period.weekStart;
        payload.period_week_end = state.period.weekEnd;
        if (action === "save") {
          payload.rows = overrides?.rows ?? parseJsonArray(state.rowsJson, "rows");
        }
        if (action === "modify") {
          payload.updates = overrides?.updates ?? parseJsonArray(state.updatesJson, "updates");
        }

        const result = await postAction(state.ctx, payload);
        dispatch({ type: "set_result", payload: result });
        dispatch({
          type: "set_result_state",
          value: deriveResultState(state.resultState, action, result),
        });
        const [statusPayload, framePayload] = await Promise.all([
          fetchStatus(state.ctx),
          fetchFrame(state.ctx),
        ]);
        dispatch({ type: "set_status", payload: statusPayload });
        syncTab4DeliveryState(statusPayload);
        dispatch({ type: "set_frame", payload: framePayload });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const failure: RuntimeEnvelope<Record<string, unknown>> = {
          status: "error",
          error_code: "FRONTEND_ACTION_FAILED",
          message,
        };
        dispatch({ type: "set_result", payload: failure });
        dispatch({
          type: "set_result_state",
          value: deriveResultState(state.resultState, action, failure),
        });
        return failure;
      } finally {
        dispatch({ type: "busy", value: false });
      }
    },
    [state.ctx, state.period, state.resultState, state.route.mainTab, state.route.subTab, state.rowsJson, state.updatesJson, syncTab4DeliveryState],
  );

  const runAction = useCallback(
    async (
      action: ActionPayload["action"],
      overrides?: {
        rows?: Array<Record<string, unknown>>;
        updates?: Array<Record<string, unknown>>;
        route?: ActionRouteOverride;
      },
    ): Promise<boolean> => {
      const result = await runActionWithResult(action, overrides);
      return result.status === "ok";
    },
    [runActionWithResult],
  );

  return {
    state,
    dispatch,
    refreshRuntime,
    refreshStatus,
    refreshFrame,
    runAction,
    runActionWithResult,
  };
}
