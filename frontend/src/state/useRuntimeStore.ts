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
  SspMediaDemandSlot,
  SubTab,
  Workflow,
} from "../types";
import {
  defaultMainTabByWorkflow,
  defaultDirtyState,
  defaultResultState,
  normalizeSubTabByMainTab,
  normalizeRowLimit,
  persistState,
  resolveTab4DeliveryReadiness,
  restorePersistedState,
  updatePeriodPreset,
  updatePeriodWindow,
} from "./runtimeContract";
import { hasDspRowsInDateBucket, resolvePreferredDspDateBucket } from "../shell/dspRawdataFilters";

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

function applyTab4DeliveryReadiness(state: RuntimeState, period: PeriodState): RuntimeState {
  const delivery = state.statusPayload?.result?.tab4_delivery;
  if (!delivery) {
    return state;
  }
  const readiness = resolveTab4DeliveryReadiness(delivery, period);
  return {
    ...state,
    tab4DeliveryReady: readiness.ready,
    tab4DeliveryReason: readiness.reason,
    tab4DeliveryUpdatedAt: new Date().toISOString(),
    tab4DeliverySnapshotToken: readiness.snapshotToken,
    tab4DeliveryRunId: readiness.deliveryRunId,
  };
}

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

export function normalizeSaveRowsPayload(
  rows: Array<Record<string, unknown>>,
  fieldNames?: string[],
): Array<Record<string, unknown>> {
  const frameOnlySaveKeys = new Set(["row_order", "updated_at"]);
  const normalizedFields = Array.isArray(fieldNames)
    ? fieldNames.filter((field) => typeof field === "string" && field.trim() !== "")
    : [];

  if (normalizedFields.length > 0) {
    return rows.map((row) => {
      const normalized: Record<string, unknown> = {};
      for (const field of normalizedFields) {
        if (Object.prototype.hasOwnProperty.call(row, field)) {
          normalized[field] = row[field];
        }
      }
      return normalized;
    });
  }

  return rows.map((row) => {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (frameOnlySaveKeys.has(key)) {
        continue;
      }
      normalized[key] = value;
    }
    return normalized;
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

function applyFramePayload(
  state: RuntimeState,
  framePayload: RuntimeEnvelope<RuntimeFrameResult>,
): RuntimeState {
  if (
    state.ctx.workflow !== "dsp"
    || state.route.workflow !== "dsp"
    || state.route.mainTab !== "dsp_tab3"
  ) {
    return {
      ...state,
      framePayload,
    };
  }
  const rows = Array.isArray(framePayload.result?.rows)
    ? (framePayload.result.rows as Array<Record<string, unknown>>)
    : [];
  if (rows.length === 0 || hasDspRowsInDateBucket(rows, state.dspRawdataFilters.dateBucket)) {
    return {
      ...state,
      framePayload,
    };
  }
  const preferredBucket = resolvePreferredDspDateBucket(rows);
  if (preferredBucket === state.dspRawdataFilters.dateBucket) {
    return {
      ...state,
      framePayload,
    };
  }
  const nextPeriod = updatePeriodPreset(state.period, preferredBucket);
  return {
    ...state,
    framePayload,
    period: nextPeriod,
    dspRawdataFilters: {
      ...state.dspRawdataFilters,
      dateBucket: preferredBucket,
    },
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
        const nextPeriod = updatePeriodWindow(state.period, state.period.weekStart, state.period.weekEnd);
        return {
          ...state,
          ctx: { ...state.ctx, workflow: action.value },
          route: { workflow: action.value, mainTab: nextMainTab, subTab: nextSubTab },
          period: nextPeriod,
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
      {
        const nextPeriod = updatePeriodPreset(state.period, action.value);
        return applyTab4DeliveryReadiness({ ...state, period: nextPeriod }, nextPeriod);
      }
    case "set_period_window":
      {
        const nextPeriod = updatePeriodWindow(state.period, action.weekStart, action.weekEnd);
        return applyTab4DeliveryReadiness({ ...state, period: nextPeriod }, nextPeriod);
      }
    case "set_row_filter":
      return { ...state, rowFilter: action.value };
    case "set_row_limit":
      return { ...state, rowLimit: normalizeRowLimit(action.value) };
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
      return applyTab4DeliveryReadiness({ ...state, statusPayload: action.payload }, state.period);
    case "set_frame":
      return applyFramePayload({ ...state, framePayload: action.payload }, action.payload);
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
      const readiness = resolveTab4DeliveryReadiness(delivery, state.period);
      dispatch({
        type: "set_tab4_delivery_ready",
        value: readiness.ready,
        reason: readiness.reason,
        snapshotToken: readiness.snapshotToken,
        deliveryRunId: readiness.deliveryRunId,
      });
    },
    [dispatch, state.period],
  );

  const refreshRuntime = useCallback(async () => {
    dispatch({ type: "busy", value: true });
    try {
      const [statusPayload, framePayload] = await Promise.all([
        fetchStatus(state.ctx),
        fetchFrame(state.ctx, {
          period_week_start: state.period.weekStart,
          period_week_end: state.period.weekEnd,
        }, {
          main_tab: state.route.mainTab,
          sub_tab: state.route.subTab,
        }),
      ]);
      dispatch({ type: "set_status", payload: statusPayload });
      syncTab4DeliveryState(statusPayload);
      dispatch({ type: "set_frame", payload: framePayload });
    } finally {
      dispatch({ type: "busy", value: false });
    }
  }, [state.ctx, state.period.weekEnd, state.period.weekStart, state.route.mainTab, state.route.subTab, syncTab4DeliveryState]);

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
      const payload = await fetchFrame(state.ctx, {
        period_week_start: state.period.weekStart,
        period_week_end: state.period.weekEnd,
      }, {
        main_tab: state.route.mainTab,
        sub_tab: state.route.subTab,
      });
      dispatch({ type: "set_frame", payload });
    } finally {
      dispatch({ type: "busy", value: false });
    }
  }, [state.ctx, state.period.weekEnd, state.period.weekStart, state.route.mainTab, state.route.subTab]);

  const runActionWithResult = useCallback(
    async (
      action: ActionPayload["action"],
      overrides?: {
        rows?: Array<Record<string, unknown>>;
        updates?: Array<Record<string, unknown>>;
        sspMediaSlots?: SspMediaDemandSlot[];
        monthlyP4?: { month: string; inputs: Record<string, number> };
        monthlyP4Template?: { kind: "base" | "check"; filename: string; contentBase64: string };
        sspAdGroup?: { zoneGroupId: number; date: string };
        route?: ActionRouteOverride;
        deferRefresh?: boolean;
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
          const inputRows = overrides?.rows ?? parseJsonArray(state.rowsJson, "rows");
          const allowedFieldNames = Array.isArray(state.framePayload?.result?.field_names)
            ? state.framePayload.result.field_names
            : undefined;
          payload.rows = normalizeSaveRowsPayload(inputRows, allowedFieldNames);
        }
        if (action === "modify") {
          payload.updates = overrides?.updates ?? parseJsonArray(state.updatesJson, "updates");
        }
        if (action === "ssp_media_save") {
          payload.ssp_media_slots = overrides?.sspMediaSlots ?? [];
        }
        if (action === "monthly_p4_save") {
          payload.month = overrides?.monthlyP4?.month || "";
          payload.monthly_p4_inputs = overrides?.monthlyP4?.inputs || {};
        }
        if (action === "monthly_p4_test_save") {
          payload.month = overrides?.monthlyP4?.month || "";
          payload.monthly_p4_inputs = overrides?.monthlyP4?.inputs || {};
        }
        if (action === "monthly_p4_test_template_upload") {
          payload.template_kind = overrides?.monthlyP4Template?.kind;
          payload.filename = overrides?.monthlyP4Template?.filename || "";
          payload.content_base64 = overrides?.monthlyP4Template?.contentBase64 || "";
        }
        if (action === "monthly_p4_close") {
          payload.month = overrides?.monthlyP4?.month || "";
        }
        if (action === "fetch_ssp_ad_group_api") {
          payload.zone_group_id = overrides?.sspAdGroup?.zoneGroupId;
          payload.date = overrides?.sspAdGroup?.date || state.period.weekEnd;
        }

        const result = await postAction(state.ctx, payload);
        if (action === "sandbox_reset" && result.status === "ok") {
          dispatch({ type: "set_rows_json", value: "[]" });
          dispatch({ type: "set_updates_json", value: "[]" });
          dispatch({ type: "set_dirty_state", value: defaultDirtyState });
        }
        dispatch({ type: "set_result", payload: result });
        dispatch({
          type: "set_result_state",
          value: deriveResultState(state.resultState, action, result),
        });
        const refreshRuntimePayloads = async () => {
          const [statusPayload, framePayload] = await Promise.all([
            fetchStatus(state.ctx),
            fetchFrame(state.ctx, {
              period_week_start: state.period.weekStart,
              period_week_end: state.period.weekEnd,
            }, {
              main_tab: effectiveMainTab,
              sub_tab: effectiveSubTab,
            }),
          ]);
          dispatch({ type: "set_status", payload: statusPayload });
          syncTab4DeliveryState(statusPayload);
          dispatch({ type: "set_frame", payload: framePayload });
        };
        if (overrides?.deferRefresh) {
          void refreshRuntimePayloads().catch(() => undefined);
        } else {
          await refreshRuntimePayloads();
        }
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
    [
      state.ctx,
      state.framePayload,
      state.period,
      state.resultState,
      state.route.mainTab,
      state.route.subTab,
      state.rowsJson,
      state.updatesJson,
      syncTab4DeliveryState,
    ],
  );

  const runAction = useCallback(
    async (
      action: ActionPayload["action"],
      overrides?: {
        rows?: Array<Record<string, unknown>>;
        updates?: Array<Record<string, unknown>>;
        sspMediaSlots?: SspMediaDemandSlot[];
        monthlyP4?: { month: string; inputs: Record<string, number> };
        route?: ActionRouteOverride;
        deferRefresh?: boolean;
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
