import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Tab4TemplateDetail, Tab4TemplateSummary, Workflow } from "../../types";
import { ActionButton, DataStateBlock, Panel, TableContainer } from "../ui";
import type { RowData } from "./shared";
import { numValue } from "./shared";
import { formatAmount } from "../../utils/format";

type Tab4WorkspaceProps = {
  rows: RowData[];
  templateSummary: Tab4TemplateSummary | null;
  templateDetail: Tab4TemplateDetail | null;
  workflow: Workflow;
  busy: boolean;
  mainTabLabel: string;
  onExport: () => void;
  deliveryReady: boolean;
  deliveryReason: string;
  deliverySnapshotToken: string;
  deliveryRunId: string;
  previewContract: { kind: string; note: string } | null;
  exportDeliverySnapshotToken: string;
  onReturnToPivotForDelivery: () => void;
  onRefreshFrame: () => Promise<void>;
};

type MatrixRowSpec = {
  id: string;
  groupTitle: string;
  levelB: string;
  levelC: string;
  levelD: string;
  matcher?: (row: RowData) => boolean;
  noteOnly?: boolean;
};

type MatrixRowStats = {
  spec: MatrixRowSpec;
  monthlyAmounts: number[];
  annualAmount: number;
  monthlyRates: Array<number | null>;
  annualRate: number | null;
};

type MfSummaryMatrix = {
  year: number;
  monthTotals: number[];
  monthTotalRates: Array<number | null>;
  annualTotal: number;
  annualRate: number | null;
  rows: MatrixRowStats[];
};

const SUMMARY_ROW_SPECS: MatrixRowSpec[] = [
  {
    id: "r3",
    groupTitle: "全體經銷商\\n分項績效",
    levelB: "內經銷商",
    levelC: "營銷事業處",
    levelD: "",
    matcher: (row) => {
      const b = pickCategory(row, ["分類層級B", "最終經銷商", "經銷商"]);
      return b === "內經銷商" || b === "外經銷商" || b === "HB串接";
    },
  },
  {
    id: "r4",
    groupTitle: "",
    levelB: "內經銷商",
    levelC: "策略部",
    levelD: "",
    matcher: (row) => {
      const b = pickCategory(row, ["分類層級B", "最終經銷商", "經銷商"]);
      const c = pickCategory(row, ["分類層級C", "最終廣告形式", "廣告形式"]);
      return b === "內經銷商" && c === "策略部";
    },
  },
  {
    id: "r5",
    groupTitle: "",
    levelB: "外經銷商",
    levelC: "經銷推廣",
    levelD: "玩藝/春樹/ADGeek等",
    matcher: (row) => {
      const b = pickCategory(row, ["分類層級B", "最終經銷商", "經銷商"]);
      const c = pickCategory(row, ["分類層級C", "最終廣告形式", "廣告形式"]);
      return b === "外經銷商" && c === "經銷推廣";
    },
  },
  {
    id: "r6",
    groupTitle: "",
    levelB: "外經銷商",
    levelC: "IO委刊",
    levelD: "momo、DOOH委刊",
    matcher: (row) => {
      const b = pickCategory(row, ["分類層級B", "最終經銷商", "經銷商"]);
      const c = pickCategory(row, ["分類層級C", "最終廣告形式", "廣告形式"]);
      return b === "外經銷商" && c === "IO委刊";
    },
  },
  {
    id: "r7",
    groupTitle: "",
    levelB: "HB串接",
    levelC: "MD",
    levelD: "Appier/宇匯Bridgewell /Criteo/ RTBhouse/Teads/ucfunnel少許",
    matcher: (row) => {
      const b = pickCategory(row, ["分類層級B", "最終經銷商", "經銷商"]);
      return b === "HB串接";
    },
  },
  {
    id: "r8",
    groupTitle: "",
    levelB: "上方HB為DSP使用額, 串接實際收入需去對方系統查核對帳",
    levelC: "",
    levelD: "",
    noteOnly: true,
  },
  {
    id: "r9",
    groupTitle: "全體經銷商\\n分項績效",
    levelB: "三螢",
    levelC: "一般廣告",
    levelD: "",
    matcher: (row) => {
      const b = pickCategory(row, ["分類層級B", "最終經銷商", "經銷商"]);
      const c = pickCategory(row, ["分類層級C", "最終廣告形式", "廣告形式"]);
      return b === "三螢" && c === "一般廣告";
    },
  },
  {
    id: "r10",
    groupTitle: "",
    levelB: "三螢",
    levelC: "創意",
    levelD: "蓋板/置底(展開&不展)/文中",
    matcher: (row) => {
      const b = pickCategory(row, ["分類層級B", "最終經銷商", "經銷商"]);
      const c = pickCategory(row, ["分類層級C", "最終廣告形式", "廣告形式"]);
      return b === "三螢" && c === "創意";
    },
  },
  {
    id: "r11",
    groupTitle: "",
    levelB: "三螢",
    levelC: "影音",
    levelD: "影音摩天(outstream)",
    matcher: (row) => {
      const b = pickCategory(row, ["分類層級B", "最終經銷商", "經銷商"]);
      const c = pickCategory(row, ["分類層級C", "最終廣告形式", "廣告形式"]);
      const d = pickCategory(row, ["分類層級D", "素材樣板", "素材", "訂單"]);
      return b === "三螢" && c === "影音" && d.includes("影音摩天");
    },
  },
  {
    id: "r12",
    groupTitle: "",
    levelB: "三螢",
    levelC: "影音",
    levelD: "pre roll (instream)",
    matcher: (row) => {
      const b = pickCategory(row, ["分類層級B", "最終經銷商", "經銷商"]);
      const c = pickCategory(row, ["分類層級C", "最終廣告形式", "廣告形式"]);
      const d = pickCategory(row, ["分類層級D", "素材樣板", "素材", "訂單"]);
      return b === "三螢" && c === "影音" && d.toLowerCase().includes("pre roll");
    },
  },
  {
    id: "r13",
    groupTitle: "",
    levelB: "DOOH外部",
    levelC: "影音",
    levelD: "前線媒體/presco",
    matcher: (row) => pickCategory(row, ["分類層級B", "最終經銷商", "經銷商"]) === "DOOH外部",
  },
  {
    id: "r14",
    groupTitle: "",
    levelB: "DOOH北流",
    levelC: "影音",
    levelD: "北流",
    matcher: (row) => pickCategory(row, ["分類層級B", "最終經銷商", "經銷商"]) === "DOOH北流",
  },
  {
    id: "r15",
    groupTitle: "",
    levelB: "CTV",
    levelC: "影音",
    levelD: "",
    matcher: (row) => pickCategory(row, ["分類層級B", "最終經銷商", "經銷商"]) === "CTV",
  },
];

function pickCategory(row: RowData, keys: string[]): string {
  for (const key of keys) {
    const raw = row[key];
    const text = String(raw ?? "").trim();
    if (text) {
      return text;
    }
  }
  return "";
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function buildMfSummaryMatrixFromTemplate(templateSummary: Tab4TemplateSummary): MfSummaryMatrix {
  const rows = SUMMARY_ROW_SPECS.map<MatrixRowStats>((spec, idx) => {
    const source = templateSummary.rows[idx];
    return {
      spec,
      monthlyAmounts: source?.monthlyAmounts || Array.from({ length: 12 }, () => 0),
      annualAmount: source?.annualAmount || 0,
      monthlyRates: source?.monthlyRates || Array.from({ length: 12 }, () => null),
      annualRate: source?.annualRate ?? null,
    };
  });
  return {
    year: templateSummary.year || new Date().getFullYear(),
    monthTotals: templateSummary.monthTotals || Array.from({ length: 12 }, () => 0),
    monthTotalRates: templateSummary.monthTotalRates || Array.from({ length: 12 }, () => null),
    annualTotal: templateSummary.annualTotal || 0,
    annualRate: templateSummary.annualRate ?? null,
    rows,
  };
}


function buildBeiliuTracking(rows: RowData[]): RowData[] {
  const filtered = rows.filter((row) => {
    const order = String(row["訂單"] ?? "");
    const material = String(row["素材"] ?? "");
    return order.includes("北流") || material.includes("北流");
  });
  return filtered.slice(0, 100).map((row) => ({
    日期時間: String(row["日期時間"] ?? ""),
    訂單: String(row["訂單"] ?? ""),
    素材: String(row["素材"] ?? ""),
    最終經銷商: String(row["最終經銷商"] ?? row["經銷商"] ?? ""),
    執行金額: numValue(row["執行金額"]),
  }));
}

type SheetFrameProps = {
  year: string;
  title: string;
  subtitle: string;
  tone: "summary" | "detail" | "tracking";
  meta?: Array<{ label: string; value: string }>;
  children: ReactNode;
};

function SheetFrame({ year, title, subtitle, tone, meta, children }: SheetFrameProps) {
  return (
    <section className={`tab4-sheet tab4-sheet-${tone}`}>
      <div className="tab4-sheet-rail">
        <span className="tab4-sheet-year">{year}</span>
        <span className="tab4-sheet-title">{title}</span>
      </div>
      <div className="tab4-sheet-banner">{subtitle}</div>
      {meta && meta.length > 0 ? (
        <div className="tab4-sheet-meta">
          {meta.map((item) => (
            <div key={item.label} className="tab4-sheet-meta-item">
              <span className="tab4-sheet-meta-label">{item.label}</span>
              <strong className="tab4-sheet-meta-value">{item.value}</strong>
            </div>
          ))}
        </div>
      ) : null}
      <div className="tab4-sheet-body">{children}</div>
    </section>
  );
}

function MfSummaryMatrixView({ templateSummary }: { templateSummary: Tab4TemplateSummary }) {
  const matrix = useMemo(
    () => buildMfSummaryMatrixFromTemplate(templateSummary),
    [templateSummary],
  );

  return (
    <div className="table-wrap tab4-mf-matrix-wrap" data-testid="tab4-mf-summary-matrix">
      <table className="tab4-mf-matrix">
        <thead>
          <tr>
            <th colSpan={4} className="tab4-mf-title-cell">{matrix.year} mF投資量_總表</th>
            {Array.from({ length: 12 }, (_v, idx) => (
              <th key={`m-${idx + 1}`} colSpan={2} className="tab4-mf-month-cell">{idx + 1}月</th>
            ))}
            <th colSpan={2} className="tab4-mf-month-cell">年度(總)</th>
          </tr>
          <tr>
            <th colSpan={4} className="tab4-mf-total-label">DSP投資額 總計</th>
            {matrix.monthTotals.map((value, idx) => (
              <Fragment key={`total-${idx}`}>
                <th className="tab4-mf-num">{formatAmount(value)}</th>
                <th className="tab4-mf-rate">{pct(matrix.monthTotalRates[idx] ?? 0)}</th>
              </Fragment>
            ))}
            <th className="tab4-mf-num">{formatAmount(matrix.annualTotal)}</th>
            <th className="tab4-mf-rate">{pct(matrix.annualRate ?? 0)}</th>
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((item) => (
            <tr key={item.spec.id}>
              <td className="tab4-mf-group">{item.spec.groupTitle}</td>
              <td className="tab4-mf-lb">{item.spec.levelB}</td>
              <td className="tab4-mf-lc">{item.spec.levelC}</td>
              <td className="tab4-mf-ld">{item.spec.levelD}</td>
              {item.monthlyAmounts.map((value, idx) => (
                <Fragment key={`${item.spec.id}-${idx}`}>
                  <td className="tab4-mf-num">
                    {item.spec.noteOnly ? "" : formatAmount(value)}
                  </td>
                  <td className="tab4-mf-rate">
                    {item.spec.noteOnly ? "" : pct(item.monthlyRates[idx] || 0)}
                  </td>
                </Fragment>
              ))}
              <td className="tab4-mf-num">{item.spec.noteOnly ? "" : formatAmount(item.annualAmount)}</td>
              <td className="tab4-mf-rate">{item.spec.noteOnly ? "" : pct(item.annualRate || 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function rateText(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "0.0%";
  }
  return pct(value);
}

function MfDetailMatrixView({ templateDetail }: { templateDetail: Tab4TemplateDetail }) {
  return (
    <div className="table-wrap tab4-detail-matrix-wrap" data-testid="tab4-mf-detail-matrix">
      <table className="tab4-detail-matrix">
        <thead>
          <tr>
            <th colSpan={4} className="tab4-detail-title-cell">各經銷商明細</th>
            {templateDetail.monthLabels.map((label, idx) => (
              <th key={`detail-month-${idx}`} colSpan={2} className="tab4-detail-month-cell">{label}</th>
            ))}
            <th colSpan={2} className="tab4-detail-month-cell">年度(總)</th>
          </tr>
        </thead>
        <tbody>
          {templateDetail.kpiRows.map((row) => (
            <tr key={`kpi-${row.excelRow}`} className="tab4-detail-kpi-row">
              <td colSpan={4} className="tab4-detail-kpi-label">{row.label}</td>
              {row.monthlyAmounts.map((amount, idx) => (
                <Fragment key={`kpi-${row.excelRow}-${idx}`}>
                  <td className="tab4-detail-num">{formatAmount(amount)}</td>
                  <td className="tab4-detail-rate">{rateText(row.monthlyRates[idx])}</td>
                </Fragment>
              ))}
              <td className="tab4-detail-num">{formatAmount(row.annualAmount)}</td>
              <td className="tab4-detail-rate">{rateText(row.annualRate)}</td>
            </tr>
          ))}
          {templateDetail.sections.map((section) => (
            <Fragment key={`section-${section.id}`}>
              <tr className="tab4-detail-section-year">
                <td className="tab4-detail-year-cell">{section.year || ""}</td>
                <td colSpan={3} className="tab4-detail-year-label">各經銷商明細分區</td>
                {section.monthLabels.map((label, idx) => (
                  <Fragment key={`year-${section.id}-${idx}`}>
                    <td className="tab4-detail-month-label">{label}</td>
                    <td className="tab4-detail-month-label tab4-detail-month-label-rate">FR%</td>
                  </Fragment>
                ))}
                <td className="tab4-detail-month-label">年度(總)</td>
                <td className="tab4-detail-month-label tab4-detail-month-label-rate">FR%</td>
              </tr>
              <tr className="tab4-detail-total-row">
                <td className="tab4-detail-label-a">{section.total.labelA}</td>
                <td className="tab4-detail-label-b">{section.total.labelB}</td>
                <td className="tab4-detail-label-c">{section.total.labelC}</td>
                <td className="tab4-detail-label-d">{section.total.labelD}</td>
                {section.total.monthlyAmounts.map((amount, idx) => (
                  <Fragment key={`total-${section.id}-${idx}`}>
                    <td className="tab4-detail-num">{formatAmount(amount)}</td>
                    <td className="tab4-detail-rate">{rateText(section.total.monthlyRates[idx])}</td>
                  </Fragment>
                ))}
                <td className="tab4-detail-num">{formatAmount(section.total.annualAmount)}</td>
                <td className="tab4-detail-rate">{rateText(section.total.annualRate)}</td>
              </tr>
              {section.rows.map((row) => (
                <tr key={`row-${section.id}-${row.excelRow}`} className="tab4-detail-body-row">
                  <td className="tab4-detail-label-a">{row.labelA}</td>
                  <td className="tab4-detail-label-b">{row.labelB}</td>
                  <td className="tab4-detail-label-c">{row.labelC}</td>
                  <td className="tab4-detail-label-d">{row.labelD}</td>
                  {row.monthlyAmounts.map((amount, idx) => (
                    <Fragment key={`row-${section.id}-${row.excelRow}-${idx}`}>
                      <td className="tab4-detail-num">{formatAmount(amount)}</td>
                      <td className="tab4-detail-rate">{rateText(row.monthlyRates[idx])}</td>
                    </Fragment>
                  ))}
                  <td className="tab4-detail-num">{formatAmount(row.annualAmount)}</td>
                  <td className="tab4-detail-rate">{rateText(row.annualRate)}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Tab4Workspace({
  rows,
  templateSummary,
  templateDetail,
  workflow,
  busy,
  mainTabLabel,
  onExport,
  deliveryReady,
  deliveryReason,
  deliverySnapshotToken,
  deliveryRunId,
  previewContract,
  exportDeliverySnapshotToken,
  onReturnToPivotForDelivery,
  onRefreshFrame,
}: Tab4WorkspaceProps) {
  const [activePanel, setActivePanel] = useState<"summary" | "detail" | "tracking">("summary");
  const detailRefreshRequested = useRef(false);
  const deliveryLocked = workflow === "dsp" && !deliveryReady;
  const lockReasonText = deliveryReason === "rawdata_saved"
    ? "偵測到 Rawdata 已重新儲存，請回樞紐重新確認後再交付。"
    : "尚未完成樞紐交付，請先回樞紐按下「送最後資料到 Tab4」。";

  const beiliuRows = buildBeiliuTracking(rows);
  const workspaceTabs = [
    { value: "summary", label: "mF投資量_總表" },
    { value: "detail", label: "各經銷商明細" },
    { value: "tracking", label: "北流進單追蹤" },
  ] as const;

  const activeTitle =
    activePanel === "summary"
      ? "mF投資量_總表"
      : activePanel === "detail"
        ? "各經銷商明細"
        : "北流進單追蹤";
  const activeSubtitle =
    activePanel === "summary"
      ? "DSP投資額 總計"
      : activePanel === "detail"
        ? "營銷處 DSP投資額 總計"
        : "北流進單追蹤";
  const activeTone = activePanel === "summary" ? "summary" : activePanel === "detail" ? "detail" : "tracking";
  const deliveryToken = deliverySnapshotToken.trim();
  const deliveryRun = deliveryRunId.trim();
  const snapshotMatchesExport = !exportDeliverySnapshotToken || !deliveryToken || exportDeliverySnapshotToken === deliveryToken;
  const activeMeta =
    activePanel === "summary"
      ? [
          { label: "模板可見區", value: "A1:AD15" },
          { label: "資料來源", value: "canonical_raw mapped preview" },
          { label: "欄位配置", value: "固定分項列 + 月份/年度成對欄位" },
        ]
      : activePanel === "detail"
        ? [
          { label: "區塊", value: "各經銷商明細（模板矩陣）" },
          { label: "資料來源", value: "canonical_raw mapped preview" },
          { label: "表格", value: "固定分區 + 月份/FR% + 年度欄位" },
        ]
        : [
            { label: "區塊", value: "北流進單追蹤" },
            { label: "資料來源", value: "訂單 / 素材" },
            { label: "表格", value: "進單狀態" },
          ];

  useEffect(() => {
    if (activePanel !== "detail") {
      detailRefreshRequested.current = false;
      return;
    }
    if (busy || templateDetail || detailRefreshRequested.current) {
      return;
    }
    detailRefreshRequested.current = true;
    void onRefreshFrame();
  }, [activePanel, busy, onRefreshFrame, templateDetail]);

  const activeBody = activePanel === "summary" ? (
    <>
      <DataStateBlock loading={busy} empty={!busy && !templateSummary} />
      {!busy && templateSummary ? (
        <MfSummaryMatrixView templateSummary={templateSummary} />
      ) : null}
    </>
  ) : activePanel === "detail" ? (
    <div className="tab4-sheet-sections">
      <section className="tab4-sheet-section">
        <div className="tab4-sheet-section-head">各經銷商明細（模板骨架）</div>
        <DataStateBlock loading={busy} empty={!busy && !templateDetail} />
        {!busy && templateDetail ? <MfDetailMatrixView templateDetail={templateDetail} /> : null}
      </section>
    </div>
  ) : (
    <div className="tab4-sheet-sections">
      <section className="tab4-sheet-section">
        <div className="tab4-sheet-section-head">北流進單追蹤</div>
        <DataStateBlock loading={busy} empty={!busy && beiliuRows.length === 0} />
        {!busy && beiliuRows.length > 0 ? (
          <TableContainer
            className="tab4-matrix-table tab4-matrix-table-tracking"
            columns={["日期時間", "訂單", "素材", "最終經銷商", "執行金額"]}
            rows={beiliuRows}
            columnFormatters={{ 執行金額: formatAmount }}
          />
        ) : (
          !busy ? <div className="state-block empty">目前無北流關鍵字資料</div> : null
        )}
      </section>
    </div>
  );

  return (
    <Panel title={`${workflow.toUpperCase()} Tab4 Workspace`} subtitle={`${mainTabLabel}：出貨 / 報表 / 定稿工作區`} full className="tab4-panel">
      {deliveryLocked ? (
        <>
          <div className="state-block empty" data-testid="tab4-delivery-locked">
            Tab4 尚未解鎖。{lockReasonText}
          </div>
          <div className="btn-row">
            <ActionButton
              label="回樞紐完成交付"
              onClick={onReturnToPivotForDelivery}
              disabled={busy}
              variant="secondary"
              testId="action-return-pivot"
            />
            <ActionButton
              label="Export Tab4 Workbook"
              onClick={() => undefined}
              disabled
              variant="secondary"
              testId="action-export"
            />
          </div>
        </>
      ) : null}
      {!deliveryLocked ? (
        <>
      <div className="workspace-note" data-testid="tab4-delivery-identity">
        交付身份：{deliveryToken || "尚未產生"}{deliveryRun ? `（run: ${deliveryRun}）` : ""}
        {previewContract ? `｜預覽契約：${previewContract.kind}` : ""}
        {previewContract?.note ? `｜${previewContract.note}` : ""}
      </div>
      {!snapshotMatchesExport ? (
        <div className="state-block warn" data-testid="tab4-delivery-mismatch">
          上次 export 與目前 Tab4 交付身份不同，請回 Pivot 重新交付後再匯出。
        </div>
      ) : null}
      <div className="tab-row" role="tablist" aria-label="Tab4 workspace tabs">
        {workspaceTabs.map((tab) => (
          <ActionButton
            key={tab.value}
            label={tab.label}
            onClick={() => setActivePanel(tab.value)}
            disabled={busy}
            variant={activePanel === tab.value ? "primary" : "ghost"}
            testId={`tab4-${tab.value}`}
            role="tab"
            ariaSelected={activePanel === tab.value}
          />
        ))}
      </div>
      <SheetFrame year="2026" title={activeTitle} subtitle={activeSubtitle} tone={activeTone} meta={activeMeta}>
        <p className="workspace-note tab4-sheet-note">
          {activePanel === "summary"
            ? "固定映射模板可見區 A1:AD15"
            : activePanel === "detail"
              ? "經銷商與廣告形式明細"
              : "關鍵字追蹤（訂單 / 素材含北流）"}
        </p>
        {activeBody}
      </SheetFrame>
      <div className="btn-row">
        <ActionButton
          label="Export Tab4 Workbook"
          onClick={onExport}
          disabled={busy}
          variant="secondary"
          testId="action-export"
        />
        <ActionButton label="Publish (Reserved)" onClick={() => undefined} disabled variant="ghost" testId="action-publish" />
      </div>
        </>
      ) : null}
    </Panel>
  );
}
