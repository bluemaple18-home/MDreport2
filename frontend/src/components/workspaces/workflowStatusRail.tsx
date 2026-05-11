import type { DirtyState, Workflow } from "../../types";
import { Panel } from "../ui";
import type { RecentMap } from "./shared";
import { formatNumber } from "../../utils/format";

type WorkflowStatusRailProps = {
  workflow: Workflow;
  dirtyState: DirtyState;
  latestRunId: string;
  latestResultStatus: string;
  recent: RecentMap;
  full?: boolean;
};

export function WorkflowStatusRail({
  workflow,
  dirtyState,
  latestRunId,
  latestResultStatus,
  recent,
  full = true,
}: WorkflowStatusRailProps) {
  const latestPublish = recent.publishRuns[0] || {};
  const latestEvidence = recent.evidenceIndex[0] || {};
  return (
    <Panel title={`${workflow.toUpperCase()} Status Rail`} subtitle="dirty / latest result / publish / evidence" full={full}>
      <div className="status-bar">
        <span>dirty_rows: {formatNumber(dirtyState.rowCount)}</span>
        <span>dirty_fields: {formatNumber(dirtyState.manualOverrideCount)}</span>
        <span>has_dirty: {dirtyState.hasDirty ? "yes" : "no"}</span>
        <span>latest_result: {latestResultStatus || "idle"}</span>
        <span>latest_run_id: {latestRunId || "n/a"}</span>
      </div>
      <div className="status-bar">
        <span>run_log_count: {formatNumber(recent.runLog.length)}</span>
        <span>publish_count: {formatNumber(recent.publishRuns.length)}</span>
        <span>evidence_count: {formatNumber(recent.evidenceIndex.length)}</span>
        <span>latest_publish: {String(latestPublish.run_id || "n/a")}</span>
        <span>latest_evidence: {String(latestEvidence.path || "n/a")}</span>
      </div>
    </Panel>
  );
}
