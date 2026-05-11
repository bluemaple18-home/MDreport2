import { useEffect, useMemo, useState } from "react";
import type { RecentMap } from "../components/workspaces/shared";
import { buildExportDownloadUrl } from "../api/runtimeApi";
import { getMainTabOptions, getSubTabOptions } from "../state/runtimeContract";
import { useRuntimeStore } from "../state/useRuntimeStore";
import type { DspRawdataFilters, MainTab, RuntimeFrameResult, SubTab, Workflow } from "../types";
import { defaultDspRawdataFilters, filterDspRawdataRows, resolvePreferredDspDateBucket } from "./dspRawdataFilters";
import { useRawdataEditingController } from "./useRawdataEditingController";
import { getWorkflowCapability, getWorkspaceVisibilityCapability } from "./workflowCapabilities";

type RuntimeAction = "bootstrap" | "health";

type TabOption = {
  value: string;
  label: string;
};

export function useAppShellController() {
  const { state, dispatch, refreshRuntime, refreshStatus, refreshFrame, runAction, runActionWithResult } = useRuntimeStore();
  const [runtimeDetailsOpen, setRuntimeDetailsOpen] = useState<boolean>(false);
  const [dspRawdataAutoSeeded, setDspRawdataAutoSeeded] = useState<boolean>(false);

  useEffect(() => {
    void refreshRuntime();
  }, [refreshRuntime]);

  const healthStatus =
    state.statusPayload?.status === "ok"
      ? String((state.statusPayload.result?.health as Record<string, unknown> | undefined)?.status || "unknown")
      : "error";

  const frameResult = state.framePayload?.result as RuntimeFrameResult | undefined;
  const allColumns = frameResult?.columns || [];
  const allRows = frameResult?.rows || [];
  const tab4TemplateSummary = frameResult?.tab4_preview_template_summary || null;
  const tab4TemplateDetail = frameResult?.tab4_preview_template_detail || null;
  const tab4PreviewContract = frameResult?.tab4_preview_contract || null;
  const manualFields = frameResult?.manual_fields || [];
  const workflowCapability = useMemo(() => getWorkflowCapability(state.route.workflow), [state.route.workflow]);
  const rawdataCapability = workflowCapability.rawdata;
  const workspaceVisibility = useMemo(() => getWorkspaceVisibilityCapability(state.route), [state.route]);
  const mainTabOptions = getMainTabOptions(state.route.workflow) as TabOption[];
  const subTabOptions = getSubTabOptions(state.route.mainTab) as TabOption[];
  const mainTabLabel = mainTabOptions.find((item) => item.value === state.route.mainTab)?.label || state.route.mainTab;
  const subTabLabel = subTabOptions.find((item) => item.value === state.route.subTab)?.label || state.route.subTab;

  const filteredRows = useMemo(() => {
    if (state.route.workflow === "dsp" && state.route.subTab === "rawdata") {
      return filterDspRawdataRows(allRows, state.dspRawdataFilters, state.rowLimit);
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
    if (dspRawdataAutoSeeded || state.route.workflow !== "dsp" || state.route.subTab !== "rawdata") {
      return;
    }
    if (allRows.length === 0) {
      return;
    }
    if (state.dspRawdataFilters.dateBucket !== defaultDspRawdataFilters.dateBucket) {
      return;
    }
    const preferredBucket = resolvePreferredDspDateBucket(allRows);
    if (preferredBucket !== state.dspRawdataFilters.dateBucket) {
      dispatch({
        type: "set_dsp_rawdata_filters",
        value: { ...state.dspRawdataFilters, dateBucket: preferredBucket },
      });
    }
    setDspRawdataAutoSeeded(true);
  }, [allRows, dispatch, dspRawdataAutoSeeded, state.dspRawdataFilters, state.route.subTab, state.route.workflow]);

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
    setPeriodPreset: (preset: "current_week" | "last_week" | "custom") => dispatch({ type: "set_period_preset", value: preset }),
    setPeriodWindow: (weekStart: string, weekEnd: string) => dispatch({ type: "set_period_window", weekStart, weekEnd }),
    setRowFilter: (value: string) => dispatch({ type: "set_row_filter", value }),
    setRowLimit: (value: number) => dispatch({ type: "set_row_limit", value }),
    setDspRawdataFilters: (value: DspRawdataFilters) => dispatch({ type: "set_dsp_rawdata_filters", value }),
    setRowsJson: (value: string) => dispatch({ type: "set_rows_json", value }),
    setUpdatesJson: (value: string) => dispatch({ type: "set_updates_json", value }),
    runRuntimeAction: (action: RuntimeAction) => runAction(action),
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
      });
      if (result.status !== "ok") {
        return;
      }
      const artifactPath = String((result.result || {}).artifact_path || "");
      if (!artifactPath) {
        return;
      }
      const downloadUrl = buildExportDownloadUrl(state.ctx, artifactPath, dspExportRoute);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.rel = "noopener";
      link.target = "_blank";
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      window.setTimeout(() => {
        link.remove();
      }, 0);
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
