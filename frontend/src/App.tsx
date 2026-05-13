import { MainWorkspaceRenderer } from "./shell/MainWorkspaceRenderer";
import { RuntimeUtilityStrip } from "./shell/RuntimeUtilityStrip";
import { WorkbenchCommandDeck } from "./shell/WorkbenchCommandDeck";
import { useAppShellController } from "./shell/useAppShellController";

export default function App() {
  const controller = useAppShellController();

  return (
    <div className="page">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <main className="layout">
        <WorkbenchCommandDeck
          healthStatus={controller.healthStatus}
          workflow={controller.state.route.workflow}
          busy={controller.state.busy}
          mainTab={controller.state.route.mainTab}
          subTab={controller.state.route.subTab}
          mainTabLabel={controller.mainTabLabel}
          mainTabOptions={controller.mainTabOptions}
          subTabOptions={controller.subTabOptions}
          periodPreset={controller.state.period.preset}
          periodWeekStart={controller.state.period.weekStart}
          periodWeekEnd={controller.state.period.weekEnd}
          dspPeriodLocked={controller.dspPeriodLocked}
          onWorkflowChange={controller.setWorkflow}
          onMainTabChange={controller.setMainTab}
          onSubTabChange={controller.setSubTab}
          onPeriodPresetChange={controller.setPeriodPreset}
          onPeriodRangeChange={controller.setPeriodWindow}
        />

        <MainWorkspaceRenderer
          route={{
            workflow: controller.state.route.workflow,
            mainTab: controller.state.route.mainTab,
            subTab: controller.state.route.subTab,
          }}
          view={{
            mainTabLabel: controller.mainTabLabel,
            subTabLabel: controller.subTabLabel,
            showSspParity: controller.showSspParity,
            showTab4Workspace: controller.showTab4Workspace,
            tab4DeliveryReady: controller.tab4DeliveryReady,
            tab4DeliveryReason: controller.tab4DeliveryReason,
            tab4DeliverySnapshotToken: controller.tab4DeliverySnapshotToken,
            tab4DeliveryRunId: controller.tab4DeliveryRunId,
          }}
          data={{
            allRows: controller.allRows,
            tab4TemplateSummary: controller.tab4TemplateSummary,
            tab4TemplateDetail: controller.tab4TemplateDetail,
            tab4PreviewContract: controller.tab4PreviewContract,
            filteredRows: controller.filteredRows,
            allColumns: controller.allColumns,
            manualFields: controller.manualFields,
            rowFilter: controller.state.rowFilter,
            rowLimit: controller.state.rowLimit,
            rowsJson: controller.state.rowsJson,
            updatesJson: controller.state.updatesJson,
            busy: controller.state.busy,
            periodLabel: controller.state.period.label,
            periodWeekStart: controller.state.period.weekStart,
            periodWeekEnd: controller.state.period.weekEnd,
            dirtyState: controller.state.dirtyState,
            recent: controller.recent,
            resultPayload: controller.state.resultPayload,
            resultState: controller.state.resultState,
            exportDeliverySnapshotToken: controller.exportDeliverySnapshotToken,
            sspMediaDemandConfig: controller.sspMediaDemandConfig,
            runtimeContext: controller.state.ctx,
          }}
          actions={{
            setRowFilter: controller.setRowFilter,
            setRowLimit: controller.setRowLimit,
            setDspRawdataFilters: controller.setDspRawdataFilters,
            setRowsJson: controller.setRowsJson,
            setUpdatesJson: controller.setUpdatesJson,
            handleEdit: controller.handleEdit,
            handleRevertCell: controller.handleRevertCell,
            handleSave: controller.handleSave,
            handleModify: controller.handleModify,
            handleExport: controller.handleExport,
            refreshFrame: controller.refreshFrame,
            handleSendPivotToTab4: controller.handleSendPivotToTab4,
            handleReturnToPivotForDelivery: controller.handleReturnToPivotForDelivery,
            handleSspMediaSave: controller.handleSspMediaSave,
          }}
          rawdataView={{
            capability: controller.rawdataCapability,
            hasValidationErrors: controller.hasValidationErrors,
            dspRawdataFilters: controller.dspRawdataFilters,
            getCellValue: controller.getCellValue,
            getCellError: controller.getCellError,
            isCellEdited: controller.isCellEdited,
            getColumnInputKind: controller.getColumnInputKind,
            getRowBadgeStatus: controller.getRowBadgeStatus,
            getRowEditCount: controller.getRowEditCount,
          }}
        />

        <RuntimeUtilityStrip
          healthStatus={controller.healthStatus}
          workflow={controller.state.route.workflow}
          mainTab={controller.state.route.mainTab}
          subTab={controller.state.route.subTab}
          dirtyRowCount={controller.state.dirtyState.rowCount}
          dirtyHasDirty={controller.state.dirtyState.hasDirty}
          dirtyManualOverrideCount={controller.state.dirtyState.manualOverrideCount}
          runLogCount={controller.recent.runLog.length}
          publishCount={controller.recent.publishRuns.length}
          evidenceCount={controller.recent.evidenceIndex.length}
          runtimeDetailsOpen={controller.runtimeDetailsOpen}
          busy={controller.state.busy}
          latestRunId={controller.state.resultState.runId}
          latestResultStatus={controller.state.resultState.status}
          recent={controller.recent}
          templateVersion={controller.state.ctx.template_version}
          ruleVersion={controller.state.ctx.rule_version}
          artifactRoot={controller.state.ctx.artifact_root}
          sandboxId={controller.state.ctx.sandbox}
          rowsLoaded={controller.allRows.length}
          visibleRows={controller.filteredRows.length}
          rowLimit={controller.state.rowLimit}
          onToggleDetails={() => controller.setRuntimeDetailsOpen((prev) => !prev)}
          onRuntimeAction={(action) => void controller.runRuntimeAction(action)}
          onRefreshStatus={() => void controller.refreshStatus()}
          onRefreshFrame={() => void controller.refreshFrame()}
        />
      </main>
    </div>
  );
}
