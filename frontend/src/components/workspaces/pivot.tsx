import type { Workflow } from "../../types";
import { ActionButton, DataStateBlock, Panel, TableContainer } from "../ui";
import { filterSummaryRows, summarizeExcludedSummaryRows } from "./distributorSummaryFilters";
import { WorkspaceInsightPanel } from "./insight";
import type { RecentMap, RowData } from "./shared";
import { formatAmount, formatNumber } from "../../utils/format";

type PivotWorkspaceProps = {
  rows: RowData[];
  columns: string[];
  busy: boolean;
  workflow: Workflow;
  recent: RecentMap;
  onSendToTab4: () => Promise<boolean>;
};

type PivotMatrix = {
  columns: string[];
  rows: RowData[];
  totalRow: RowData;
  excludedRows: RowData[];
  topDistributor: string;
  topAdFormat: string;
  topAmount: number;
};

function buildPivotMatrix(rows: RowData[]): PivotMatrix {
  const summaryRows = filterSummaryRows(rows);
  const excludedRows = summarizeExcludedSummaryRows(rows);
  const distributorFormatAmount = new Map<string, Map<string, number>>();
  const adFormatTotals = new Map<string, number>();
  const distributorTotals = new Map<string, number>();

  for (const row of summaryRows) {
    const distributor = String(row["最終經銷商"] ?? row["經銷商"] ?? "(未指定)");
    const adFormat = String(row["最終廣告形式"] ?? row["廣告形式"] ?? "(未指定)");
    const amount = Number(row["執行金額"] ?? 0);
    const safeAmount = Number.isFinite(amount) ? amount : 0;
    const formatMap = distributorFormatAmount.get(distributor) ?? new Map<string, number>();
    formatMap.set(adFormat, (formatMap.get(adFormat) ?? 0) + safeAmount);
    distributorFormatAmount.set(distributor, formatMap);
    adFormatTotals.set(adFormat, (adFormatTotals.get(adFormat) ?? 0) + safeAmount);
    distributorTotals.set(distributor, (distributorTotals.get(distributor) ?? 0) + safeAmount);
  }

  const adFormats = Array.from(adFormatTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([adFormat]) => adFormat);
  const distributors = Array.from(distributorTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([distributor]) => distributor);

  const pivotRows: RowData[] = distributors.map((distributor) => {
    const formatMap = distributorFormatAmount.get(distributor) ?? new Map<string, number>();
    const rowPayload: RowData = { 經銷商: distributor };
    let rowTotal = 0;
    for (const adFormat of adFormats) {
      const value = formatMap.get(adFormat) ?? 0;
      rowPayload[adFormat] = value;
      rowTotal += value;
    }
    rowPayload["總計"] = rowTotal;
    return rowPayload;
  });

  const totalRow: RowData = { 經銷商: "總計" };
  let totalAmount = 0;
  for (const adFormat of adFormats) {
    const value = adFormatTotals.get(adFormat) ?? 0;
    totalRow[adFormat] = value;
    totalAmount += value;
  }
  totalRow["總計"] = totalAmount;

  const topDistributor = distributors[0] ?? "n/a";
  const topAdFormat = adFormats[0] ?? "n/a";
  const topAmount = Number(adFormatTotals.get(topAdFormat) ?? 0);

  return {
    columns: ["經銷商", ...adFormats, "總計"],
    rows: pivotRows.slice(0, 50),
    totalRow,
    excludedRows,
    topDistributor,
    topAdFormat,
    topAmount,
  };
}

export function PivotWorkspace({ rows, columns, busy, workflow, recent, onSendToTab4 }: PivotWorkspaceProps) {
  const pivotMatrix = buildPivotMatrix(rows);
  const pivotColumns = pivotMatrix.columns;
  const pivotRows = pivotMatrix.rows;
  return (
    <Panel title={`${workflow.toUpperCase()} 樞紐 Workspace`} subtitle="只讀核對，不作 state source" full testId="section-pivot">
      <details className="workspace-debug" open={false}>
        <summary>樞紐核對資訊</summary>
        <div className="status-bar">
          <span>source: sqlite canonical frame</span>
          <span>rows: {formatNumber(rows.length)}</span>
          <span>pivot_rows: {formatNumber(pivotRows.length)}</span>
          <span>excluded_distributors: {formatNumber(pivotMatrix.excludedRows.length)}</span>
          <span>pivot_columns: {formatNumber(Math.max(0, pivotColumns.length - 1))}</span>
        </div>
        <div className="workflow-cockpit">
          <div className="cockpit-card">
            <h3>樞紐節奏</h3>
            <div className="metric-list">
              <span>核對模式: read-only</span>
              <span>列群組(經銷商): {formatNumber(pivotRows.length)}</span>
              <span>欄群組(廣告形式): {formatNumber(Math.max(0, pivotColumns.length - 2))}</span>
              <span>raw_columns: {formatNumber(columns.length)}</span>
            </div>
          </div>
          <div className="cockpit-card">
            <h3>當前焦點</h3>
            <div className="metric-list">
              <span>top_經銷商: {pivotMatrix.topDistributor}</span>
              <span>top_廣告形式: {pivotMatrix.topAdFormat}</span>
              <span>top_廣告形式_執行金額: {formatAmount(pivotMatrix.topAmount)}</span>
            </div>
          </div>
        </div>
        <WorkspaceInsightPanel
          rows={rows}
          recent={recent}
          variant="overview"
          showSummaryTable={false}
          note="樞紐只做核對，不改 canonical source。"
        />
      </details>
      <DataStateBlock loading={busy} empty={!busy && pivotRows.length === 0} />
      {!busy && pivotRows.length > 0 ? (
        <TableContainer
          columns={pivotColumns}
          rows={pivotRows}
          columnFormatters={Object.fromEntries(
            pivotColumns
              .filter((column) => column !== "經銷商")
              .map((column) => [column, formatAmount]),
          )}
          footerRows={[pivotMatrix.totalRow]}
        />
      ) : null}
      <div className="btn-row">
        <ActionButton
          label="送最後資料到 Tab4"
          onClick={() => {
            void onSendToTab4();
          }}
          disabled={busy || workflow !== "dsp" || pivotRows.length === 0}
          variant="secondary"
          testId="action-send-tab4"
        />
      </div>
      <details className="workspace-debug">
        <summary>已排除經銷商（未列入樞紐計算）</summary>
        {pivotMatrix.excludedRows.length > 0 ? (
          <TableContainer
            columns={["經銷商", "排除原因", "筆數", "執行金額"]}
            rows={pivotMatrix.excludedRows}
            columnFormatters={{
              筆數: formatNumber,
              執行金額: formatAmount,
            }}
          />
        ) : (
          <p className="workspace-note">目前沒有被排除的經銷商。</p>
        )}
      </details>
    </Panel>
  );
}
