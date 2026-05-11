import { TableContainer } from "../ui";
import { RecentMap, RowData, compactPath, numValue, textOf } from "./shared";
import { formatAmount, formatNumber } from "../../utils/format";

export type OverviewMetrics = {
  totalInvest: number;
  totalRevenue: number;
  averageInvest: number;
  roi: number;
  topDistributor: string;
  topFormat: string;
};

export type WorkspaceInsightData = {
  metrics: OverviewMetrics;
  latestRunId: string;
  latestRunStatus: string;
  latestRunType: string;
  latestPublishRunId: string;
  latestPublishTemplate: string;
  latestPublishStatus: string;
  latestPublishFile: string;
  latestEvidenceRunId: string;
  latestEvidenceScope: string;
  latestEvidenceFile: string;
};

function summarizeRows(rows: RowData[]): OverviewMetrics {
  if (rows.length === 0) {
    return {
      totalInvest: 0,
      totalRevenue: 0,
      averageInvest: 0,
      roi: 0,
      topDistributor: "n/a",
      topFormat: "n/a",
    };
  }
  const distributorStats = new Map<string, number>();
  const formatStats = new Map<string, number>();
  let totalInvest = 0;
  let totalRevenue = 0;
  for (const row of rows) {
    const distributor = textOf(row["最終經銷商"] ?? row["經銷商"], "(empty)");
    const adFormat = textOf(row["最終廣告形式"] ?? row["廣告形式"], "(empty)");
    const invest = numValue(row["執行金額"]);
    const revenue = numValue(row["系統營收"]);
    totalInvest += invest;
    totalRevenue += revenue;
    distributorStats.set(distributor, (distributorStats.get(distributor) || 0) + invest);
    formatStats.set(adFormat, (formatStats.get(adFormat) || 0) + invest);
  }
  const topDistributor = Array.from(distributorStats.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "n/a";
  const topFormat = Array.from(formatStats.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "n/a";
  return {
    totalInvest,
    totalRevenue,
    averageInvest: totalInvest / rows.length,
    roi: totalInvest === 0 ? 0 : totalRevenue / totalInvest,
    topDistributor,
    topFormat,
  };
}

export function buildWorkspaceInsightData(rows: RowData[], recent: RecentMap): WorkspaceInsightData {
  const metrics = summarizeRows(rows);
  const latestRun = recent.runLog[0] || {};
  const latestPublish = recent.publishRuns[0] || {};
  const latestEvidence = recent.evidenceIndex[0] || {};
  return {
    metrics,
    latestRunId: textOf(latestRun.run_id, "n/a"),
    latestRunStatus: textOf(latestRun.status, "n/a"),
    latestRunType: textOf(latestRun.run_type, "n/a"),
    latestPublishRunId: textOf(latestPublish.run_id, "n/a"),
    latestPublishTemplate: textOf(latestPublish.template_id, "n/a"),
    latestPublishStatus: textOf(latestPublish.status, "n/a"),
    latestPublishFile: compactPath(latestPublish.output_path),
    latestEvidenceRunId: textOf(latestEvidence.run_id, "n/a"),
    latestEvidenceScope: textOf(latestEvidence.scope, "n/a"),
    latestEvidenceFile: compactPath(latestEvidence.path),
  };
}

type WorkspaceInsightPanelProps = {
  rows: RowData[];
  recent: RecentMap;
  insight?: WorkspaceInsightData;
  variant?: "overview" | "result";
  showSummaryTable?: boolean;
  note?: string;
};

export function WorkspaceInsightPanel({
  rows,
  recent,
  insight,
  variant = "overview",
  showSummaryTable = true,
  note = "",
}: WorkspaceInsightPanelProps) {
  const insightData = insight || buildWorkspaceInsightData(rows, recent);
  const titleA = variant === "overview" ? "Data Snapshot" : "Canonical Snapshot";
  const titleB = variant === "overview" ? "Top Focus" : "Trace Focus";
  return (
    <div className="workspace-insight">
      <div className="metrics-grid">
        <div className="metric-card">
          <h3>{titleA}</h3>
          <div className="metric-list">
            <span>執行金額合計: {formatAmount(insightData.metrics.totalInvest)}</span>
            <span>系統營收合計: {formatAmount(insightData.metrics.totalRevenue)}</span>
            <span>平均單筆投資: {formatAmount(insightData.metrics.averageInvest)}</span>
            <span>ROI: {formatNumber(insightData.metrics.roi)}</span>
          </div>
        </div>
        <div className="metric-card">
          <h3>{titleB}</h3>
          <div className="metric-list">
            <span>top_distributor: {insightData.metrics.topDistributor}</span>
            <span>top_ad_format: {insightData.metrics.topFormat}</span>
            <span>latest_run: {insightData.latestRunId}</span>
            <span>latest_status: {insightData.latestRunStatus}</span>
          </div>
        </div>
      </div>
      <div className="recent-grid">
        <div>
          <h3 className="section-title">Latest Publish</h3>
          <div className="status-bar">
            <span>run_id: {insightData.latestPublishRunId}</span>
            <span>template: {insightData.latestPublishTemplate}</span>
            <span>status: {insightData.latestPublishStatus}</span>
            <span>file: {insightData.latestPublishFile}</span>
          </div>
        </div>
        <div>
          <h3 className="section-title">Latest Evidence</h3>
          <div className="status-bar">
            <span>run_id: {insightData.latestEvidenceRunId}</span>
            <span>scope: {insightData.latestEvidenceScope}</span>
            <span>file: {insightData.latestEvidenceFile}</span>
          </div>
        </div>
      </div>
      {note ? <p className="workspace-note">{note}</p> : null}
      {showSummaryTable ? (
        <TableContainer
          columns={["項目", "值"]}
          rows={[
            { 項目: "top_distributor", 值: insightData.metrics.topDistributor },
            { 項目: "top_ad_format", 值: insightData.metrics.topFormat },
            { 項目: "total_invest", 值: insightData.metrics.totalInvest },
            { 項目: "total_revenue", 值: insightData.metrics.totalRevenue },
            { 項目: "latest_run_type", 值: insightData.latestRunType },
          ]}
          columnFormatters={{ 值: (value) => (typeof value === "number" ? formatAmount(value) : String(value ?? "")) }}
        />
      ) : null}
    </div>
  );
}
