import { ActionButton, Panel } from "../components/ui";
import { WorkflowStatusRail } from "../components/workspaces";
import type { Workflow } from "../types";
import type { RecentMap } from "../components/workspaces/shared";
import { formatNumber } from "../utils/format";

type RuntimeAction = "bootstrap" | "health";

type RuntimeUtilityStripProps = {
  healthStatus: string;
  workflow: Workflow;
  mainTab: string;
  subTab: string;
  dirtyRowCount: number;
  dirtyHasDirty: boolean;
  dirtyManualOverrideCount: number;
  runLogCount: number;
  publishCount: number;
  evidenceCount: number;
  runtimeDetailsOpen: boolean;
  busy: boolean;
  latestRunId: string;
  latestResultStatus: string;
  recent: RecentMap;
  templateVersion: string;
  ruleVersion: string;
  artifactRoot: string;
  rowsLoaded: number;
  visibleRows: number;
  rowLimit: number;
  onToggleDetails: () => void;
  onRuntimeAction: (action: RuntimeAction) => void;
  onRefreshStatus: () => void;
  onRefreshFrame: () => void;
};

const RUNTIME_ACTIONS: Array<{ label: string; action: RuntimeAction; variant?: "primary" | "secondary" | "ghost" }> = [
  { label: "Bootstrap", action: "bootstrap" },
  { label: "Health", action: "health", variant: "secondary" },
];

export function RuntimeUtilityStrip({
  healthStatus,
  workflow,
  mainTab,
  subTab,
  dirtyRowCount,
  dirtyHasDirty,
  dirtyManualOverrideCount,
  runLogCount,
  publishCount,
  evidenceCount,
  runtimeDetailsOpen,
  busy,
  latestRunId,
  latestResultStatus,
  recent,
  templateVersion,
  ruleVersion,
  artifactRoot,
  rowsLoaded,
  visibleRows,
  rowLimit,
  onToggleDetails,
  onRuntimeAction,
  onRefreshStatus,
  onRefreshFrame,
}: RuntimeUtilityStripProps) {
  return (
    <section className="panel panel-full workbench-runtime-strip">
      <header className="panel-header">
        <h2>Runtime Utility Strip</h2>
        <p>單行摘要優先，詳細資訊按需展開。</p>
      </header>
      <div className="panel-body">
        <div className="runtime-strip-summary">
          <div className="status-bar runtime-strip-summary-bar">
            <span>Runtime Context</span>
            <span>Service Input</span>
            <span>health: {healthStatus}</span>
            <span>workflow: {workflow}</span>
            {mainTab === "ssp_anomaly" ? (
              <span>main: {mainTab}</span>
            ) : (
              <span>main/sub: {mainTab} / {subTab}</span>
            )}
            <span>dirty: {dirtyHasDirty ? "yes" : "no"} ({formatNumber(dirtyManualOverrideCount)})</span>
            <span>run_log: {formatNumber(runLogCount)}</span>
            <span>publish: {formatNumber(publishCount)}</span>
            <span>evidence: {formatNumber(evidenceCount)}</span>
          </div>
          <div className="runtime-strip-toggle">
            <ActionButton
              label={runtimeDetailsOpen ? "收合詳細" : "展開詳細"}
              variant="ghost"
              onClick={onToggleDetails}
              disabled={busy}
            />
          </div>
        </div>

        {runtimeDetailsOpen ? (
          <div className="runtime-strip-grid">
            <div className="runtime-strip-card">
              <WorkflowStatusRail
                workflow={workflow}
                dirtyState={{
                  rowCount: dirtyRowCount,
                  manualOverrideCount: dirtyManualOverrideCount,
                  hasDirty: dirtyHasDirty,
                  lastTouchedAt: "",
                }}
                latestRunId={latestRunId}
                latestResultStatus={latestResultStatus}
                recent={recent}
                full={false}
              />
            </div>

            <div className="runtime-strip-card">
              <Panel title="Runtime Actions" subtitle="bootstrap / health / refresh">
                <div className="btn-row runtime-action-row">
                  {RUNTIME_ACTIONS.map((cfg) => (
                    <ActionButton
                      key={cfg.action}
                      label={cfg.label}
                      onClick={() => onRuntimeAction(cfg.action)}
                      disabled={busy}
                      variant={cfg.variant}
                    />
                  ))}
                  <ActionButton label="Refresh Status" onClick={onRefreshStatus} disabled={busy} variant="ghost" />
                  <ActionButton label="Refresh Frame" onClick={onRefreshFrame} disabled={busy} variant="ghost" />
                </div>
              </Panel>
            </div>

            <div className="runtime-strip-card">
              <Panel title="Runtime Context" subtitle="Service Input 與目前工作台使用的 runtime state">
                <div className="status-bar">
                  <span>workflow: {workflow}</span>
                  <span>main_tab: {mainTab}</span>
                  {mainTab === "ssp_anomaly" ? null : <span>sub_tab: {subTab}</span>}
                </div>
                <div className="status-bar">
                  <span>Service Input</span>
                </div>
                <div className="status-bar">
                  <span>template_version: {templateVersion}</span>
                  <span>rule_version: {ruleVersion}</span>
                  <span>artifact_root: {artifactRoot}</span>
                </div>
                <div className="status-bar">
                  <span>rows_loaded: {formatNumber(rowsLoaded)}</span>
                  <span>visible_rows: {formatNumber(visibleRows)}</span>
                  <span>row_limit: {formatNumber(rowLimit)}</span>
                </div>
              </Panel>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
