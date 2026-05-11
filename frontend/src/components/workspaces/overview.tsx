import type { DirtyState, Workflow } from "../../types";
import { Panel, TableContainer } from "../ui";
import { WorkspaceInsightPanel } from "./insight";
import type { RecentMap, RowData } from "./shared";
import { numValue, textOf } from "./shared";
import { formatAmount, formatNumber, formatPercent } from "../../utils/format";

type OverviewWorkspaceProps = {
  workflow: Workflow;
  mainTabLabel: string;
  subTabLabel: string;
  rowCount: number;
  periodLabel: string;
  dirtyState: DirtyState;
  rows: RowData[];
  recent: RecentMap;
};

export function OverviewWorkspace({
  workflow,
  mainTabLabel,
  subTabLabel,
  rowCount,
  periodLabel,
  dirtyState,
  rows,
  recent,
}: OverviewWorkspaceProps) {
  const flowCaption = workflow === "dsp"
    ? "DSP：Tab3/Tab4 的資料編修、樞紐核對與輸出節奏。"
    : "SSP：成效救火/媒體要量的對稱工作台流程。";

  const dirtyPercent = rowCount > 0 ? Math.round((dirtyState.rowCount / rowCount) * 100) : 0;
  const rowsReady = rowCount > 0;
  const reviewReady = rowsReady && !dirtyState.hasDirty;
  const actionLane = workflow === "dsp"
    ? [
        { lane: "Tab3 編修", cue: dirtyState.hasDirty ? "有未提交調整" : "已清空待改動", state: dirtyState.hasDirty ? "active" : "ready" },
        { lane: "樞紐核對", cue: rowsReady ? "可檢查群組趨勢" : "等待資料", state: rowsReady ? "ready" : "waiting" },
        { lane: "Tab4 產出", cue: reviewReady ? "可進入定稿輸出" : "先完成資料整理", state: reviewReady ? "ready" : "waiting" },
      ]
    : [
        { lane: "成效救火", cue: rowsReady ? "可檢查異常候選" : "等待資料", state: rowsReady ? "ready" : "waiting" },
        { lane: "媒體要量", cue: dirtyState.hasDirty ? "有調整待確認" : "量體可盤點", state: dirtyState.hasDirty ? "active" : "ready" },
        { lane: "Result 回放", cue: reviewReady ? "可確認輸出狀態" : "建議先收斂修改", state: reviewReady ? "ready" : "waiting" },
      ];

  const topDistributors = rows
    .reduce<Map<string, number>>((acc, row) => {
      const key = textOf(row["最終經銷商"] ?? row["經銷商"], "(empty)");
      acc.set(key, (acc.get(key) || 0) + numValue(row["執行金額"]));
      return acc;
    }, new Map())
    .entries();
  const distributorRows = Array.from(topDistributors)
    .map(([name, amount]) => ({ 經銷商: name, 執行金額: amount }))
    .sort((a, b) => Number(b["執行金額"]) - Number(a["執行金額"]))
    .slice(0, 5);

  const topFormats = rows
    .reduce<Map<string, number>>((acc, row) => {
      const key = textOf(row["最終廣告形式"] ?? row["廣告形式"], "(empty)");
      acc.set(key, (acc.get(key) || 0) + numValue(row["執行金額"]));
      return acc;
    }, new Map())
    .entries();
  const formatRows = Array.from(topFormats)
    .map(([name, amount]) => ({ 廣告形式: name, 執行金額: amount }))
    .sort((a, b) => Number(b["執行金額"]) - Number(a["執行金額"]))
    .slice(0, 5);

  return (
    <Panel title="Workbench Overview" subtitle={flowCaption} full>
      <div className="status-bar">
        <span>main_tab: {mainTabLabel}</span>
        <span>sub_tab: {subTabLabel}</span>
        <span>rows: {formatNumber(rowCount)}</span>
        <span>period: {periodLabel || "n/a"}</span>
      </div>
      <div className="status-bar">
        <span>dirty_rows: {formatNumber(dirtyState.rowCount)}</span>
        <span>manual_overrides: {formatNumber(dirtyState.manualOverrideCount)}</span>
        <span>has_dirty: {dirtyState.hasDirty ? "yes" : "no"}</span>
      </div>
      <div className="workflow-cockpit">
        <div className="cockpit-card">
          <h3>操作節奏</h3>
          <div className="metric-list">
            <span>資料列就緒: {rowsReady ? "yes" : "no"}</span>
            <span>dirty 比例: {formatPercent(dirtyPercent)}</span>
            <span>可進定稿: {reviewReady ? "yes" : "no"}</span>
          </div>
        </div>
        <div className="cockpit-card">
          <h3>{workflow.toUpperCase()} 主線</h3>
          <div className="workflow-lanes">
            {actionLane.map((lane) => (
              <div key={lane.lane} className={`workflow-lane workflow-lane-${lane.state}`}>
                <strong>{lane.lane}</strong>
                <span>{lane.cue}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <WorkspaceInsightPanel rows={rows} recent={recent} variant="overview" showSummaryTable={false} />
      <div className="workspace-twin-grid">
        <Panel title="Top 經銷商隊列" subtitle="按執行金額排序，快速定位主要承載方。">
          <TableContainer
            columns={["經銷商", "執行金額"]}
            rows={distributorRows}
            columnFormatters={{ 執行金額: formatAmount }}
          />
        </Panel>
        <Panel title="Top 廣告形式隊列" subtitle="用格式視角看目前流量重心。">
          <TableContainer
            columns={["廣告形式", "執行金額"]}
            rows={formatRows}
            columnFormatters={{ 執行金額: formatAmount }}
          />
        </Panel>
      </div>
    </Panel>
  );
}
