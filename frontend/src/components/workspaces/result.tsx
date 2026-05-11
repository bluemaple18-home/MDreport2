import { useState } from "react";
import type { Workflow } from "../../types";
import { ActionButton, Panel } from "../ui";
import { WorkspaceInsightPanel, buildWorkspaceInsightData } from "./insight";
import type { RecentMap, RowData } from "./shared";
import { formatNumber } from "../../utils/format";

type ResultWorkspaceProps = {
  workflow: Workflow;
  mainTabLabel: string;
  resultPayload: unknown;
  resultState: unknown;
  rows: RowData[];
  recent: RecentMap;
};

export function ResultWorkspace({
  workflow,
  mainTabLabel,
  resultPayload,
  resultState,
  rows,
  recent,
}: ResultWorkspaceProps) {
  const [activeSegment, setActiveSegment] = useState<"summary" | "action" | "state">("summary");
  const actionData = (resultPayload && typeof resultPayload === "object")
    ? resultPayload as Record<string, unknown>
    : {};
  const stateData = (resultState && typeof resultState === "object")
    ? resultState as Record<string, unknown>
    : {};

  const actionStatus = String(actionData["status"] ?? "idle");
  const actionCode = String(actionData["error_code"] ?? "none");
  const actionMessage = String(actionData["message"] ?? "");
  const resultStatus = String(stateData["status"] ?? "idle");
  const resultRunId = String(stateData["runId"] ?? "");
  const resultAction = String(stateData["lastAction"] ?? "n/a");
  const resultUpdatedAt = String(stateData["updatedAt"] ?? "");
  const insight = buildWorkspaceInsightData(rows, recent);

  return (
    <Panel title={`${workflow.toUpperCase()} Result Workspace`} subtitle={`${mainTabLabel} 執行結果與追溯`} full testId="section-result">
      <div className="status-bar">
        <span>action_status: {actionStatus}</span>
        <span>result_status: {resultStatus}</span>
        <span>run_id: {resultRunId || "n/a"}</span>
        <span>last_action: {resultAction}</span>
      </div>
      <div className="tab-row" role="tablist" aria-label="Result workspace segments">
        <ActionButton
          label="Summary"
          onClick={() => setActiveSegment("summary")}
          variant={activeSegment === "summary" ? "primary" : "ghost"}
          role="tab"
          ariaSelected={activeSegment === "summary"}
          testId="result-segment-summary"
        />
        <ActionButton
          label="Action Payload"
          onClick={() => setActiveSegment("action")}
          variant={activeSegment === "action" ? "primary" : "ghost"}
          role="tab"
          ariaSelected={activeSegment === "action"}
          testId="result-segment-action"
        />
        <ActionButton
          label="Result State"
          onClick={() => setActiveSegment("state")}
          variant={activeSegment === "state" ? "primary" : "ghost"}
          role="tab"
          ariaSelected={activeSegment === "state"}
          testId="result-segment-state"
        />
      </div>

      {activeSegment === "summary" ? (
        <Panel title="Execution Summary" subtitle="單一摘要視角，先看狀態再決定是否展開細節。">
          <div className="status-bar">
            <span>action_code: {actionCode || "none"}</span>
            <span>updated_at: {resultUpdatedAt || "n/a"}</span>
            <span>rows: {formatNumber(rows.length)}</span>
            <span>roi: {formatNumber(insight.metrics.roi)}</span>
          </div>
          <WorkspaceInsightPanel
            rows={rows}
            recent={recent}
            insight={insight}
            variant="result"
            showSummaryTable
            note={actionMessage || "目前沒有錯誤訊息，流程可繼續。"}
          />
        </Panel>
      ) : null}

      {activeSegment === "action" ? (
        <Panel title="Action Payload JSON" subtitle="API action 回傳原文（只讀）。">
          <pre className="json-view">{JSON.stringify(resultPayload || { status: "idle" }, null, 2)}</pre>
        </Panel>
      ) : null}

      {activeSegment === "state" ? (
        <Panel title="Result State JSON" subtitle="前端 result state 快照（只讀）。">
          <pre className="json-view">{JSON.stringify(resultState || { status: "idle" }, null, 2)}</pre>
        </Panel>
      ) : null}
    </Panel>
  );
}
