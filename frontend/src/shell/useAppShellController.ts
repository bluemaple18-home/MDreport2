import { useEffect, useMemo, useRef, useState } from "react";
import type { RecentMap } from "../components/workspaces/shared";
import { buildExportDownloadUrl } from "../api/runtimeApi";
import { getMainTabOptions, getSubTabOptions, shouldRefreshFrameForRoute } from "../state/runtimeContract";
import { useRuntimeStore } from "../state/useRuntimeStore";
import type { DspDateBucket, DspRawdataFilters, MainTab, MonthlyChartsSnapshot, MonthlyP4Snapshot, PeriodPreset, RuntimeFrameResult, SspMediaDemandConfig, SspMediaDemandSlot, SubTab, Workflow } from "../types";
import { collectDspFacetOptions, filterDspRawdataRows } from "./dspRawdataFilters";
import { useRawdataEditingController } from "./useRawdataEditingController";
import { getWorkflowCapability, getWorkspaceVisibilityCapability } from "./workflowCapabilities";

type RuntimeAction = "bootstrap" | "health" | "sandbox_prepare" | "sandbox_reset";

type TabOption = {
  value: string;
  label: string;
};

const EMPTY_ROWS: Array<Record<string, unknown>> = [];
const EMPTY_STRINGS: string[] = [];

function isDspDateBucketPreset(preset: PeriodPreset): preset is DspDateBucket {
  return preset === "last_week"
    || preset === "two_weeks_ago"
    || preset === "three_weeks_ago"
    || preset === "four_weeks_ago";
}

export function useAppShellController() {
  const { state, dispatch, refreshRuntime, refreshStatus, refreshFrame, runAction, runActionWithResult } = useRuntimeStore();
  const [runtimeDetailsOpen, setRuntimeDetailsOpen] = useState<boolean>(false);
  const lastAutoFrameRefreshKey = useRef<string>("");
  const runtimeContextKey = [
    state.ctx.root,
    state.ctx.env,
    state.ctx.manifest,
    state.ctx.workflow,
    state.ctx.template_version,
    state.ctx.rule_version,
    state.ctx.artifact_root,
    state.ctx.sandbox,
  ].join("\n");

  useEffect(() => {
    void refreshRuntime();
  // 只在 runtime context 改變時重抓整體 API；Tab4 的 period-aware preview 由下方 effect 單獨刷新 frame。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtimeContextKey]);

  const frameRefreshKey = [
    state.route.workflow,
    state.route.mainTab,
    state.period.weekStart,
    state.period.weekEnd,
  ].join("\n");

  useEffect(() => {
    if (!shouldRefreshFrameForRoute(state.route)) {
      return;
    }
    if (lastAutoFrameRefreshKey.current === frameRefreshKey) {
      return;
    }
    lastAutoFrameRefreshKey.current = frameRefreshKey;
    void refreshFrame();
  // 自動刷新以 route/period key 為準，避免 callback identity 變動時重複送出 frame request。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameRefreshKey]);

  const healthStatus =
    state.statusPayload?.status === "ok"
      ? String((state.statusPayload.result?.health as Record<string, unknown> | undefined)?.status || "unknown")
      : "error";

  const frameResult = state.framePayload?.result as RuntimeFrameResult | undefined;
  const allColumns = frameResult?.columns || EMPTY_STRINGS;
  const allRows = frameResult?.rows || EMPTY_ROWS;
  const tab4TemplateSummary = frameResult?.tab4_preview_template_summary || null;
  const tab4TemplateDetail = frameResult?.tab4_preview_template_detail || null;
  const tab4PreviewContract = frameResult?.tab4_preview_contract || null;
  const sspMediaDemandConfig = frameResult?.ssp_media_demand as SspMediaDemandConfig | undefined;
  const sspAdGroupMonitor = frameResult?.ssp_ad_group_monitor;
  const sspExcludingPaddingRows = frameResult?.ssp_excluding_padding_rows || EMPTY_ROWS;
  const sspPaddingScope = frameResult?.ssp_padding_scope;
  const monthlyP4 = frameResult?.monthly_p4 as MonthlyP4Snapshot | undefined;
  const monthlyP4Test = frameResult?.monthly_p4_test as MonthlyP4Snapshot | undefined;
  const monthlyCharts = frameResult?.monthly_charts as MonthlyChartsSnapshot | undefined;
  const manualFields = frameResult?.manual_fields || EMPTY_STRINGS;
  const workflowCapability = useMemo(() => getWorkflowCapability(state.route.workflow), [state.route.workflow]);
  const rawdataCapability = workflowCapability.rawdata;
  const workspaceVisibility = useMemo(() => getWorkspaceVisibilityCapability(state.route), [state.route]);
  const mainTabOptions = getMainTabOptions(state.route.workflow) as TabOption[];
  const subTabOptions = getSubTabOptions(state.route.mainTab) as TabOption[];
  const mainTabLabel = mainTabOptions.find((item) => item.value === state.route.mainTab)?.label || state.route.mainTab;
  const subTabLabel = subTabOptions.find((item) => item.value === state.route.subTab)?.label || state.route.subTab;

  const filteredRows = useMemo(() => {
    if (state.route.workflow === "dsp" && (state.route.subTab === "rawdata" || state.route.subTab === "pivot")) {
      const limit = state.route.subTab === "rawdata" ? state.rowLimit : Number.MAX_SAFE_INTEGER;
      return filterDspRawdataRows(allRows, state.dspRawdataFilters, limit);
    }
    const filter = state.rowFilter.trim().toLowerCase();
    const scoped = filter
      ? allRows.filter((row) => Object.values(row).some((v) => String(v ?? "").toLowerCase().includes(filter)))
      : allRows;
    return scoped.slice(0, state.rowLimit);
  }, [allRows, state.dspRawdataFilters, state.route.subTab, state.route.workflow, state.rowFilter, state.rowLimit]);

  const recent = useMemo<RecentMap>(() => {
    const result = state.statusPayload?.result as
      | {
          recent?: {
            run_log?: Array<Record<string, unknown>>;
            publish_runs?: Array<Record<string, unknown>>;
            evidence_index?: Array<Record<string, unknown>>;
          };
        }
      | undefined;
    return {
      runLog: result?.recent?.run_log || [],
      publishRuns: result?.recent?.publish_runs || [],
      evidenceIndex: result?.recent?.evidence_index || [],
    };
  }, [state.statusPayload]);

  const exportDeliverySnapshotToken = useMemo(() => {
    const payload = state.resultPayload?.result;
    if (!payload || typeof payload !== "object") {
      return "";
    }
    return String((payload as Record<string, unknown>).delivery_snapshot_token || "");
  }, [state.resultPayload]);

  useEffect(() => {
    if (state.route.workflow !== "dsp" || state.route.subTab !== "rawdata" || allRows.length === 0) {
      return;
    }
    const nextFilters = { ...state.dspRawdataFilters };
    const facetFields = [
      ["distributor", "distributor"],
      ["adFormat", "adFormat"],
      ["size", "size"],
      ["template", "template"],
    ] as const;
    let changed = false;
    for (const [filterKey, facetField] of facetFields) {
      const current = nextFilters[filterKey];
      if (!current) {
        continue;
      }
      const validValues = new Set(collectDspFacetOptions(allRows, facetField).map((option) => option.value));
      if (!validValues.has(current)) {
        nextFilters[filterKey] = "";
        changed = true;
      }
    }
    if (changed) {
      dispatch({ type: "set_dsp_rawdata_filters", value: nextFilters });
    }
  }, [allRows, dispatch, state.dspRawdataFilters, state.route.subTab, state.route.workflow]);

  const rawdataEditing = useRawdataEditingController({
    allRows,
    manualFields,
    rawdataCapability,
    dispatch,
    runAction,
  });

  return {
    state,
    healthStatus,
    runtimeDetailsOpen,
    setRuntimeDetailsOpen,
    allColumns,
    allRows,
    tab4TemplateSummary,
    tab4TemplateDetail,
    tab4PreviewContract,
    sspMediaDemandConfig,
    sspAdGroupMonitor,
    sspExcludingPaddingRows,
    sspPaddingScope,
    monthlyP4,
    monthlyP4Test,
    monthlyCharts,
    filteredRows,
    manualFields,
    mainTabOptions,
    subTabOptions,
    mainTabLabel,
    subTabLabel,
    recent,
    hasValidationErrors: rawdataEditing.hasValidationErrors,
    setWorkflow: (workflow: Workflow) => dispatch({ type: "set_workflow", value: workflow }),
    setMainTab: (mainTab: MainTab) => dispatch({ type: "set_main_tab", value: mainTab }),
    setSubTab: (subTab: SubTab) => dispatch({ type: "set_subtab", value: subTab }),
    setPeriodPreset: (preset: PeriodPreset) => {
      dispatch({ type: "set_period_preset", value: preset });
      if (
        state.route.workflow === "dsp"
        && isDspDateBucketPreset(preset)
      ) {
        dispatch({
          type: "set_dsp_rawdata_filters",
          value: { ...state.dspRawdataFilters, dateBucket: preset },
        });
      }
    },
    setPeriodWindow: (weekStart: string, weekEnd: string) => dispatch({ type: "set_period_window", weekStart, weekEnd }),
    setRowFilter: (value: string) => dispatch({ type: "set_row_filter", value }),
    setRowLimit: (value: number) => dispatch({ type: "set_row_limit", value }),
    setDspRawdataFilters: (value: DspRawdataFilters) => {
      dispatch({ type: "set_dsp_rawdata_filters", value });
      if (state.route.workflow === "dsp" && value.dateBucket !== state.period.preset) {
        dispatch({ type: "set_period_preset", value: value.dateBucket });
      }
    },
    setRowsJson: (value: string) => dispatch({ type: "set_rows_json", value }),
    setUpdatesJson: (value: string) => dispatch({ type: "set_updates_json", value }),
    runRuntimeAction: async (action: RuntimeAction) => {
      const ok = await runAction(action);
      if (ok && action === "sandbox_reset") {
        rawdataEditing.handleClearAllEdits();
      }
      return ok;
    },
    refreshStatus,
    refreshFrame,
    handleSave: rawdataEditing.handleSave,
    handleModify: rawdataEditing.handleModify,
    handleExport: async () => {
      if (state.route.workflow === "dsp" && state.route.mainTab !== "dsp_tab4") {
        return;
      }
      const dspExportRoute = state.route.workflow === "dsp"
        ? { main_tab: "dsp_tab4" as const, sub_tab: "overview" as const }
        : undefined;
      const result = await runActionWithResult("export", {
        route: state.route.workflow === "dsp"
          ? { mainTab: "dsp_tab4", subTab: "overview" }
          : undefined,
        deferRefresh: true,
      });
      if (result.status !== "ok") {
        return;
      }
      const artifactPath = String((result.result || {}).artifact_path || "");
      if (!artifactPath) {
        return;
      }
      const downloadUrl = buildExportDownloadUrl(state.ctx, artifactPath, dspExportRoute);
      window.location.assign(downloadUrl);
    },
    handleSendPivotToTab4: async () => {
      const ok = await runAction("tab4_delivery");
      if (!ok) {
        return false;
      }
      dispatch({ type: "set_main_tab", value: "dsp_tab4" });
      dispatch({ type: "set_subtab", value: "overview" });
      return true;
    },
    handleReturnToPivotForDelivery: () => {
      dispatch({ type: "set_main_tab", value: "dsp_tab3" });
      dispatch({ type: "set_subtab", value: "pivot" });
    },
    handleSspMediaSave: async (slots: SspMediaDemandSlot[]) => {
      const result = await runActionWithResult("ssp_media_save", { sspMediaSlots: slots });
      return result.status === "ok";
    },
    handleSspAdGroupRefresh: async (zoneGroupId: number, date: string) => {
      const result = await runActionWithResult("fetch_ssp_ad_group_api", {
        sspAdGroup: { zoneGroupId, date },
      });
      return result.status === "ok";
    },
    handleMonthlyP4Save: async (month: string, inputs: Record<string, number>) => {
      const result = await runActionWithResult("monthly_p4_save", { monthlyP4: { month, inputs } });
      if (result.status === "ok") {
        await refreshFrame();
      }
      return result.status === "ok";
    },
    handleMonthlyP4TestSave: async (month: string, inputs: Record<string, number>) => {
      const result = await runActionWithResult("monthly_p4_test_save", { monthlyP4: { month, inputs } });
      if (result.status === "ok") {
        await refreshFrame();
      }
      return result.status === "ok";
    },
    handleMonthlyP4TestTemplateUpload: async (kind: "base" | "check", file: File) => {
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || "");
          resolve(result.includes(",") ? result.split(",", 2)[1] : result);
        };
        reader.onerror = () => reject(reader.error || new Error("檔案讀取失敗"));
        reader.readAsDataURL(file);
      });
      const result = await runActionWithResult("monthly_p4_test_template_upload", {
        monthlyP4Template: { kind, filename: file.name, contentBase64 },
      });
      return result.status === "ok";
    },
    handleMonthlyP4Close: async (month: string) => {
      const result = await runActionWithResult("monthly_p4_close", { monthlyP4: { month, inputs: {} } });
      const payload = result.result || {};
      return {
        ok: result.status === "ok" && payload.status !== "skipped",
        message: result.status !== "ok"
          ? "關帳失敗，請看 Result"
          : payload.status === "skipped"
            ? "這個月份已經關帳過"
            : `關帳完成：mltiFORCE 實際績效 ${Number(payload.mf_total_actual || 0).toLocaleString("zh-TW")}`,
      };
    },
    handleEdit: rawdataEditing.handleEdit,
    handleRevertCell: rawdataEditing.handleRevertCell,
    handleClearRowEdits: rawdataEditing.handleClearRowEdits,
    getCellValue: rawdataEditing.getCellValue,
    getCellError: rawdataEditing.getCellError,
    isCellEdited: rawdataEditing.isCellEdited,
    getColumnInputKind: rawdataEditing.getColumnInputKind,
    getRowBadgeStatus: rawdataEditing.getRowBadgeStatus,
    getRowEditCount: rawdataEditing.getRowEditCount,
    dspRawdataFilters: state.dspRawdataFilters,
    showSspParity: workspaceVisibility.showSspParity,
    showTab4Workspace: workspaceVisibility.showTab4Workspace,
    dspPeriodLocked: workflowCapability.periodLocked,
    rawdataCapability,
    tab4DeliveryReady: state.tab4DeliveryReady,
    tab4DeliveryReason: state.tab4DeliveryReason,
    tab4DeliverySnapshotToken: state.tab4DeliverySnapshotToken,
    tab4DeliveryRunId: state.tab4DeliveryRunId,
    exportDeliverySnapshotToken,
  };
}
