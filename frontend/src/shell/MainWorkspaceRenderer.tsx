import {
  OverviewWorkspace,
  PivotWorkspace,
  RawdataWorkspace,
  ResultWorkspace,
  MonthlyChartsWorkspace,
  MonthlyP4Workspace,
  SspMediaDemandWorkspace,
  SspAdGroupMonitorWorkspace,
  SspParityWorkspace,
  Tab4Workspace,
} from "../components/workspaces";
import type {
  DirtyState,
  MainTab,
  ResultState,
  RuntimeContext,
  SubTab,
  Tab4TemplateDetail,
  Tab4TemplateSummary,
  Workflow,
  SspMediaDemandConfig,
  SspAdGroupMonitorSnapshot,
  SspMediaDemandSlot,
  MonthlyChartsSnapshot,
  MonthlyP4Snapshot,
} from "../types";
import type { DspRawdataFilters } from "../types";
import type { RecentMap, RowData } from "../components/workspaces/shared";
import type { RawdataCapability } from "./workflowCapabilities";

type ColumnInputKind = "text" | "number" | "datetime";
type RowBadgeStatus = "clean" | "edited" | "invalid" | "reverted";

type MainWorkspaceRendererProps = {
  route: {
    workflow: Workflow;
    mainTab: MainTab;
    subTab: SubTab;
  };
  view: {
    mainTabLabel: string;
    subTabLabel: string;
    showSspParity: boolean;
    showTab4Workspace: boolean;
    tab4DeliveryReady: boolean;
    tab4DeliveryReason: string;
    tab4DeliverySnapshotToken: string;
    tab4DeliveryRunId: string;
  };
  data: {
    allRows: RowData[];
    tab4TemplateSummary: Tab4TemplateSummary | null;
    tab4TemplateDetail: Tab4TemplateDetail | null;
    tab4PreviewContract: { kind: string; note: string } | null;
    filteredRows: RowData[];
    allColumns: string[];
    manualFields: string[];
    rowFilter: string;
    rowLimit: number;
    rowsJson: string;
    updatesJson: string;
    busy: boolean;
    periodLabel: string;
    periodWeekStart: string;
    periodWeekEnd: string;
    dirtyState: DirtyState;
    recent: RecentMap;
    resultPayload: unknown;
    resultState: ResultState;
    exportDeliverySnapshotToken: string;
    sspMediaDemandConfig?: SspMediaDemandConfig;
    sspAdGroupMonitor?: SspAdGroupMonitorSnapshot;
    monthlyP4?: MonthlyP4Snapshot;
    monthlyP4Test?: MonthlyP4Snapshot;
    monthlyCharts?: MonthlyChartsSnapshot;
    runtimeContext: RuntimeContext;
  };
  actions: {
    setRowFilter: (value: string) => void;
    setRowLimit: (value: number) => void;
    setDspRawdataFilters: (value: DspRawdataFilters) => void;
    setRowsJson: (value: string) => void;
    setUpdatesJson: (value: string) => void;
    handleEdit: (rowOrder: string | number, column: string, value: string) => void;
    handleRevertCell: (rowOrder: string | number, column: string) => void;
    handleSave: () => Promise<void>;
    handleModify: () => Promise<void>;
    handleExport: () => Promise<void>;
    refreshFrame: () => Promise<void>;
    handleSendPivotToTab4: () => Promise<boolean>;
    handleReturnToPivotForDelivery: () => void;
    handleSspMediaSave: (slots: SspMediaDemandSlot[]) => Promise<boolean>;
    handleSspAdGroupRefresh: (zoneGroupId: number, date: string) => Promise<boolean>;
    handleMonthlyP4Save: (month: string, inputs: Record<string, number>) => Promise<boolean>;
    handleMonthlyP4TestSave: (month: string, inputs: Record<string, number>) => Promise<boolean>;
    handleMonthlyP4TestTemplateUpload: (kind: "base" | "check", file: File) => Promise<boolean>;
    handleMonthlyP4Close: (month: string) => Promise<{ ok: boolean; message: string }>;
  };
  rawdataView: {
    capability: RawdataCapability;
    hasValidationErrors: boolean;
    dspRawdataFilters: DspRawdataFilters;
    getCellValue: (row: RowData, column: string, fallback: unknown, rowOrderFallback?: string | number) => string;
    getCellError: (row: RowData, column: string, rowOrderFallback?: string | number) => string;
    isCellEdited: (row: RowData, column: string, rowOrderFallback?: string | number) => boolean;
    getColumnInputKind: (column: string) => ColumnInputKind;
    getRowBadgeStatus: (row: RowData, rowOrderFallback?: string | number) => RowBadgeStatus;
    getRowEditCount: (row: RowData, rowOrderFallback?: string | number) => number;
  };
};

export function MainWorkspaceRenderer(props: MainWorkspaceRendererProps) {
  const { route, view, data, actions, rawdataView } = props;
  const showSspAnomalyWorkspace = route.workflow === "ssp" && route.mainTab === "ssp_anomaly";
  const showSspMediaDemandWorkspace = route.workflow === "ssp" && route.mainTab === "ssp_media_demand";
  const showSspAdGroupWorkspace = route.workflow === "ssp" && route.mainTab === "ssp_ad_group";
  const showMonthlyP4Workspace = route.workflow === "monthly" && route.mainTab === "monthly_p4";
  const showMonthlyChartsWorkspace = route.workflow === "monthly" && route.mainTab === "monthly_charts";
  const hideDefaultWorkspace = showSspAnomalyWorkspace || showSspMediaDemandWorkspace || showSspAdGroupWorkspace || showMonthlyP4Workspace || showMonthlyChartsWorkspace;
  const mainWorkspace = route.subTab === "overview" ? (
    <OverviewWorkspace
      workflow={route.workflow}
      mainTabLabel={view.mainTabLabel}
      subTabLabel={view.subTabLabel}
      rowCount={data.allRows.length}
      periodLabel={data.periodLabel}
      dirtyState={data.dirtyState}
      rows={data.allRows}
      recent={data.recent}
    />
  ) : route.subTab === "rawdata" ? (
    <RawdataWorkspace
      workflow={route.workflow}
      allRows={data.allRows}
      rows={data.filteredRows}
      columns={data.allColumns}
      manualFields={data.manualFields}
      rowFilter={data.rowFilter}
      rowLimit={data.rowLimit}
      capability={rawdataView.capability}
      dirtyState={data.dirtyState}
      busy={data.busy}
      rowsJson={data.rowsJson}
      updatesJson={data.updatesJson}
      onFilterChange={actions.setRowFilter}
      onRowLimitChange={actions.setRowLimit}
      onDspRawdataFiltersChange={actions.setDspRawdataFilters}
      onEdit={actions.handleEdit}
      onRevertCell={actions.handleRevertCell}
      onSave={() => void actions.handleSave()}
      onModify={() => void actions.handleModify()}
      onExport={() => void actions.handleExport()}
      allowExport={route.workflow !== "dsp"}
      onRowsJsonChange={actions.setRowsJson}
      onUpdatesJsonChange={actions.setUpdatesJson}
      getCellValue={rawdataView.getCellValue}
      getCellError={rawdataView.getCellError}
      isCellEdited={rawdataView.isCellEdited}
      getColumnInputKind={rawdataView.getColumnInputKind}
      getRowBadgeStatus={rawdataView.getRowBadgeStatus}
      getRowEditCount={rawdataView.getRowEditCount}
      hasValidationErrors={rawdataView.hasValidationErrors}
      dspRawdataFilters={rawdataView.dspRawdataFilters}
    />
  ) : route.subTab === "pivot" ? (
    <PivotWorkspace
      rows={route.workflow === "dsp" ? data.filteredRows : data.allRows}
      columns={data.allColumns}
      busy={data.busy}
      workflow={route.workflow}
      recent={data.recent}
      onSendToTab4={actions.handleSendPivotToTab4}
    />
  ) : (
    <ResultWorkspace
      workflow={route.workflow}
      mainTabLabel={view.mainTabLabel}
      resultPayload={data.resultPayload}
      resultState={data.resultState}
      rows={data.allRows}
      recent={data.recent}
    />
  );

  return (
    <section className="workbench-stage panel-full">
      <section className="workbench-main">
        {showSspAnomalyWorkspace ? (
          <SspParityWorkspace
            rows={data.allRows}
            workflow={route.workflow}
            busy={data.busy}
          />
        ) : null}
        {showSspMediaDemandWorkspace ? (
          <SspMediaDemandWorkspace
            rows={data.allRows}
            workflow={route.workflow}
            busy={data.busy}
            periodWeekStart={data.periodWeekStart}
            periodWeekEnd={data.periodWeekEnd}
            runtimeContext={data.runtimeContext}
            config={data.sspMediaDemandConfig}
            onSaveSlots={actions.handleSspMediaSave}
          />
        ) : null}
        {showSspAdGroupWorkspace ? (
          <SspAdGroupMonitorWorkspace
            snapshot={data.sspAdGroupMonitor}
            busy={data.busy}
            periodWeekStart={data.periodWeekStart}
            periodWeekEnd={data.periodWeekEnd}
            onRefresh={actions.handleSspAdGroupRefresh}
          />
        ) : null}
        {view.showTab4Workspace ? (
          <Tab4Workspace
            rows={data.allRows}
            templateSummary={data.tab4TemplateSummary}
            templateDetail={data.tab4TemplateDetail}
            workflow={route.workflow}
            busy={data.busy}
            mainTabLabel={view.mainTabLabel}
            onExport={() => void actions.handleExport()}
            deliveryReady={view.tab4DeliveryReady}
            deliveryReason={view.tab4DeliveryReason}
            deliverySnapshotToken={view.tab4DeliverySnapshotToken}
            deliveryRunId={view.tab4DeliveryRunId}
            previewContract={data.tab4PreviewContract}
            exportDeliverySnapshotToken={data.exportDeliverySnapshotToken}
            onReturnToPivotForDelivery={actions.handleReturnToPivotForDelivery}
            onRefreshFrame={actions.refreshFrame}
          />
        ) : null}
        {showMonthlyP4Workspace ? (
          <MonthlyP4Workspace
            snapshot={route.subTab === "pivot" ? data.monthlyP4Test : data.monthlyP4}
            busy={data.busy}
            onSaveInputs={route.subTab === "pivot" ? actions.handleMonthlyP4TestSave : actions.handleMonthlyP4Save}
            onUploadTestTemplate={actions.handleMonthlyP4TestTemplateUpload}
            onCloseMonth={actions.handleMonthlyP4Close}
            mode={route.subTab === "rawdata" ? "maintenance" : route.subTab === "pivot" ? "test" : "output"}
          />
        ) : null}
        {showMonthlyChartsWorkspace ? (
          <MonthlyChartsWorkspace
            snapshot={data.monthlyCharts}
            busy={data.busy}
          />
        ) : null}
        {!hideDefaultWorkspace && !view.showTab4Workspace ? mainWorkspace : null}
        {!hideDefaultWorkspace && view.showTab4Workspace ? mainWorkspace : null}
      </section>
    </section>
  );
}
