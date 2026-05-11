import { useEffect, useMemo, useRef, useState } from "react";
import type { DirtyState, DspRawdataFilters, Workflow } from "../../types";
import { ActionButton, DataStateBlock, ExportBar, Field, FilterBar, Panel, SaveBar } from "../ui";
import type { RowData } from "./shared";
import type { RawdataCapability } from "../../shell/workflowCapabilities";
import { formatDisplayValue, formatNumber } from "../../utils/format";
import { buildDspDateOptions, collectDspFacetOptions } from "../../shell/dspRawdataFilters";
import { isSummableCell, numValue } from "./shared";

type RawdataWorkspaceProps = {
  workflow: Workflow;
  allRows: RowData[];
  rows: RowData[];
  columns: string[];
  manualFields: string[];
  rowFilter: string;
  rowLimit: number;
  capability: RawdataCapability;
  dirtyState: DirtyState;
  busy: boolean;
  rowsJson: string;
  updatesJson: string;
  onFilterChange: (value: string) => void;
  onRowLimitChange: (value: number) => void;
  onDspRawdataFiltersChange: (value: DspRawdataFilters) => void;
  onEdit: (rowOrder: string | number, column: string, value: string) => void;
  onRevertCell: (rowOrder: string | number, column: string) => void;
  onSave: () => void;
  onModify: () => void;
  onExport: () => void;
  allowExport: boolean;
  onRowsJsonChange: (value: string) => void;
  onUpdatesJsonChange: (value: string) => void;
  getCellValue: (row: RowData, column: string, fallback: unknown, rowOrderFallback?: string | number) => string;
  getCellError: (row: RowData, column: string, rowOrderFallback?: string | number) => string;
  isCellEdited: (row: RowData, column: string, rowOrderFallback?: string | number) => boolean;
  getColumnInputKind: (column: string) => "text" | "number" | "datetime";
  getRowBadgeStatus: (row: RowData, rowOrderFallback?: string | number) => "clean" | "edited" | "invalid" | "reverted";
  getRowEditCount: (row: RowData, rowOrderFallback?: string | number) => number;
  dspRawdataFilters: DspRawdataFilters;
  hasValidationErrors: boolean;
};

type DspRawdataViewMode = "user" | "verify" | "pm";
type RawdataColumnWidths = Record<string, number>;
type ActiveResizeState = {
  column: string;
  startX: number;
  startWidth: number;
} | null;

const RAWDATA_COLUMN_WIDTH_STORAGE_PREFIX = "mdrep.rawdata.column-widths.v1";
const RAWDATA_COLUMN_WIDTH_MIN = 96;
const RAWDATA_COLUMN_WIDTH_MAX = 960;
const RAWDATA_COLUMN_WIDTH_DEFAULT = 168;
const RAWDATA_COLUMN_WIDTH_FIT_MIN = 48;

const DSP_RAWDATA_MODE_LABELS: Array<{ value: DspRawdataViewMode; label: string; testId: string }> = [
  { value: "user", label: "使用者看", testId: "dsp-rawdata-view-user" },
  { value: "verify", label: "核對用", testId: "dsp-rawdata-view-verify" },
  { value: "pm", label: "PM 檢查用", testId: "dsp-rawdata-view-pm" },
];

const DSP_RAWDATA_COLUMN_PROFILES: Record<DspRawdataViewMode, string[]> = {
  user: [
    "日期時間",
    "最終經銷商",
    "訂單",
    "素材",
    "最終廣告形式",
    "尺寸",
    "素材樣板",
    "執行金額",
    "媒體費用",
  ],
  verify: [
    "日期時間",
    "最終經銷商",
    "訂單",
    "素材",
    "最終廣告形式",
    "尺寸",
    "素材樣板",
    "執行金額",
    "媒體費用",
    "原始經銷商",
    "原始廣告形式",
    "最終來源_經銷商",
    "規則命中_經銷商",
    "最終來源_廣告形式",
    "規則命中_廣告形式",
  ],
  pm: [
    "日期時間",
    "最終經銷商",
    "訂單",
    "素材",
    "最終廣告形式",
    "尺寸",
    "素材樣板",
    "執行金額",
    "媒體費用",
    "原始經銷商",
    "原始廣告形式",
    "最終來源_經銷商",
    "規則命中_經銷商",
    "最終來源_廣告形式",
    "規則命中_廣告形式",
    "經銷商",
    "分類層級B",
    "分類層級C",
    "分類層級D",
    "廣告形式",
    "系統營收",
  ],
};

function resolveDspRawdataVisibleColumns(columns: string[], mode: DspRawdataViewMode): string[] {
  const profile = DSP_RAWDATA_COLUMN_PROFILES[mode];
  return profile.filter((column, idx) => profile.indexOf(column) === idx && columns.includes(column));
}

function clampColumnWidth(width: number): number {
  return Math.max(RAWDATA_COLUMN_WIDTH_MIN, Math.min(RAWDATA_COLUMN_WIDTH_MAX, Math.round(width)));
}

function buildTableTotals(rows: RowData[], columns: string[]): Record<string, number | null> {
  const totals: Record<string, number | null> = {};
  for (const column of columns) {
    const samples = rows
      .map((row) => row[column])
      .filter((value) => String(value ?? "").trim() !== "");
    if (samples.length === 0 || !samples.every((value) => isSummableCell(value))) {
      totals[column] = null;
      continue;
    }
    totals[column] = samples.reduce<number>((acc, value) => acc + numValue(value), 0);
  }
  return totals;
}

function loadStoredColumnWidths(storageKey: string): RawdataColumnWidths {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return {};
    }
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const parsed: RawdataColumnWidths = {};
    for (const [column, value] of Object.entries(payload)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        parsed[column] = clampColumnWidth(value);
      }
    }
    return parsed;
  } catch {
    return {};
  }
}

function fitWidthsIntoViewport(
  columns: string[],
  preferred: RawdataColumnWidths,
  viewportWidth: number,
  anchorColumn?: string,
): RawdataColumnWidths {
  if (columns.length === 0) {
    return {};
  }
  const safeViewport = Math.max(320, Math.floor(viewportWidth));
  const widths = columns.map((column) => {
    const saved = preferred[column];
    if (typeof saved === "number" && Number.isFinite(saved)) {
      return clampColumnWidth(saved);
    }
    return RAWDATA_COLUMN_WIDTH_DEFAULT;
  });
  const total = widths.reduce((acc, value) => acc + value, 0);
  if (total <= safeViewport) {
    const resolved: RawdataColumnWidths = {};
    columns.forEach((column, index) => {
      resolved[column] = widths[index];
    });
    return resolved;
  }
  const anchorIndex = typeof anchorColumn === "string" ? columns.indexOf(anchorColumn) : -1;
  if (anchorIndex >= 0) {
    const anchorWidth = widths[anchorIndex];
    const othersMinTotal = (columns.length - 1) * RAWDATA_COLUMN_WIDTH_FIT_MIN;
    const maxAnchor = Math.max(RAWDATA_COLUMN_WIDTH_FIT_MIN, safeViewport - othersMinTotal);
    const lockedAnchor = Math.min(anchorWidth, maxAnchor);
    const others = widths.map((value, index) => (index === anchorIndex ? 0 : value));
    const othersTotal = others.reduce((acc, value) => acc + value, 0);
    const available = Math.max((columns.length - 1) * RAWDATA_COLUMN_WIDTH_FIT_MIN, safeViewport - lockedAnchor);
    const otherScale = othersTotal > 0 ? available / othersTotal : 1;
    const anchored = widths.map((value, index) => {
      if (index === anchorIndex) {
        return lockedAnchor;
      }
      return Math.max(RAWDATA_COLUMN_WIDTH_FIT_MIN, Math.floor(value * otherScale));
    });
    let anchoredTotal = anchored.reduce((acc, value) => acc + value, 0);
    if (anchoredTotal > safeViewport) {
      for (let i = anchored.length - 1; i >= 0 && anchoredTotal > safeViewport; i -= 1) {
        if (i === anchorIndex) {
          continue;
        }
        if (anchored[i] > RAWDATA_COLUMN_WIDTH_FIT_MIN) {
          anchored[i] -= 1;
          anchoredTotal -= 1;
          i = anchored.length;
        }
      }
    }
    const resolved: RawdataColumnWidths = {};
    columns.forEach((column, index) => {
      resolved[column] = anchored[index];
    });
    return resolved;
  }
  const scale = safeViewport / total;
  const scaled = widths.map((value) => Math.max(RAWDATA_COLUMN_WIDTH_FIT_MIN, Math.floor(value * scale)));
  let scaledTotal = scaled.reduce((acc, value) => acc + value, 0);
  if (scaledTotal > safeViewport) {
    for (let i = scaled.length - 1; i >= 0 && scaledTotal > safeViewport; i -= 1) {
      if (scaled[i] > RAWDATA_COLUMN_WIDTH_FIT_MIN) {
        scaled[i] -= 1;
        scaledTotal -= 1;
        i = scaled.length;
      }
    }
  }
  const resolved: RawdataColumnWidths = {};
  columns.forEach((column, index) => {
    resolved[column] = scaled[index];
  });
  return resolved;
}

function DspRawdataFilterBar({
  allRows,
  filters,
  rowLimit,
  onDspRawdataFiltersChange,
  onRowLimitChange,
}: {
  allRows: RowData[];
  filters: DspRawdataFilters;
  rowLimit: number;
  onDspRawdataFiltersChange: (value: DspRawdataFilters) => void;
  onRowLimitChange: (value: number) => void;
}) {
  const dateOptions = useMemo(() => buildDspDateOptions(), []);
  const distributorOptions = useMemo(() => collectDspFacetOptions(allRows, "distributor"), [allRows]);
  const adFormatOptions = useMemo(() => collectDspFacetOptions(allRows, "adFormat"), [allRows]);
  const sizeOptions = useMemo(() => collectDspFacetOptions(allRows, "size"), [allRows]);
  const templateOptions = useMemo(() => collectDspFacetOptions(allRows, "template"), [allRows]);

  return (
    <div className="filter-bar filter-bar-dsp">
      <Field label="日期時間">
        <select
          data-testid="dsp-rawdata-date-bucket"
          value={filters.dateBucket}
          onChange={(e) => onDspRawdataFiltersChange({ ...filters, dateBucket: e.target.value as DspRawdataFilters["dateBucket"] })}
        >
          {dateOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="最多顯示幾筆資料">
        <select
          data-testid="dsp-rawdata-row-limit"
          value={String(rowLimit)}
          onChange={(e) => onRowLimitChange(Number(e.target.value))}
        >
          <option value="20">20</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="200">200</option>
        </select>
      </Field>
      <Field label="經銷商">
        <select
          data-testid="dsp-rawdata-distributor"
          value={filters.distributor}
          onChange={(e) => onDspRawdataFiltersChange({ ...filters, distributor: e.target.value })}
        >
          <option value="">全部</option>
          {distributorOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="廣告形式">
        <select
          data-testid="dsp-rawdata-ad-format"
          value={filters.adFormat}
          onChange={(e) => onDspRawdataFiltersChange({ ...filters, adFormat: e.target.value })}
        >
          <option value="">全部</option>
          {adFormatOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="尺寸">
        <select
          data-testid="dsp-rawdata-size"
          value={filters.size}
          onChange={(e) => onDspRawdataFiltersChange({ ...filters, size: e.target.value })}
        >
          <option value="">全部</option>
          {sizeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="素材樣板">
        <select
          data-testid="dsp-rawdata-template"
          value={filters.template}
          onChange={(e) => onDspRawdataFiltersChange({ ...filters, template: e.target.value })}
        >
          <option value="">全部</option>
          {templateOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

export function RawdataWorkspace({
  workflow,
  allRows,
  rows,
  columns,
  manualFields,
  rowFilter,
  rowLimit,
  capability,
  dirtyState,
  busy,
  rowsJson,
  updatesJson,
  onFilterChange,
  onRowLimitChange,
  onDspRawdataFiltersChange,
  onEdit,
  onSave,
  onModify,
  onExport,
  allowExport,
  onRowsJsonChange,
  onUpdatesJsonChange,
  getCellValue,
  getCellError,
  getColumnInputKind,
  getRowBadgeStatus,
  getRowEditCount,
  dspRawdataFilters,
  hasValidationErrors,
}: RawdataWorkspaceProps) {
  const canEditRawdata = capability.canEdit;
  const [dspViewMode, setDspViewMode] = useState<DspRawdataViewMode>("user");
  const [activeResize, setActiveResize] = useState<ActiveResizeState>(null);
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const [tableWrapWidth, setTableWrapWidth] = useState<number>(0);
  const columnWidthStorageKey = useMemo(
    () => `${RAWDATA_COLUMN_WIDTH_STORAGE_PREFIX}.${workflow}`,
    [workflow],
  );
  const [columnWidths, setColumnWidths] = useState<RawdataColumnWidths>(() => loadStoredColumnWidths(columnWidthStorageKey));
  const editableColumns = canEditRawdata ? manualFields.filter((col) => columns.includes(col)) : [];
  const visibleColumns = workflow === "dsp"
    ? resolveDspRawdataVisibleColumns(columns, dspViewMode)
    : [...columns];
  const enforceNoHorizontalScroll = workflow === "dsp" && dspViewMode === "user";

  useEffect(() => {
    setColumnWidths(loadStoredColumnWidths(columnWidthStorageKey));
  }, [columnWidthStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(columnWidthStorageKey, JSON.stringify(columnWidths));
    } catch {
      // localStorage 失效時維持記憶體內欄寬，不阻斷主流程。
    }
  }, [columnWidths, columnWidthStorageKey]);

  useEffect(() => {
    if (!activeResize || typeof window === "undefined") {
      return;
    }
    const onPointerMove = (event: MouseEvent) => {
      const deltaX = event.clientX - activeResize.startX;
      // 左側邊界往左拖應該變寬，往右拖應該變窄。
      const nextWidth = clampColumnWidth(activeResize.startWidth - deltaX);
      setColumnWidths((prev) => {
        if (prev[activeResize.column] === nextWidth) {
          return prev;
        }
        return {
          ...prev,
          [activeResize.column]: nextWidth,
        };
      });
    };
    const onPointerUp = () => {
      setActiveResize(null);
    };
    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", onPointerUp);
    return () => {
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("mouseup", onPointerUp);
    };
  }, [activeResize]);

  useEffect(() => {
    if (!tableWrapRef.current || typeof window === "undefined") {
      return;
    }
    const element = tableWrapRef.current;
    const updateWidth = () => setTableWrapWidth(Math.floor(element.clientWidth));
    updateWidth();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => updateWidth());
      observer.observe(element);
      return () => observer.disconnect();
    }
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, [enforceNoHorizontalScroll, workflow, dspViewMode]);

  const getColumnWidth = (column: string): number => {
    const width = columnWidths[column];
    return typeof width === "number" && Number.isFinite(width) ? clampColumnWidth(width) : RAWDATA_COLUMN_WIDTH_DEFAULT;
  };
  const effectiveColumnWidths = useMemo(() => {
    if (!enforceNoHorizontalScroll) {
      const resolved: RawdataColumnWidths = {};
      visibleColumns.forEach((column) => {
        resolved[column] = getColumnWidth(column);
      });
      return resolved;
    }
    const innerViewport = Math.max(240, tableWrapWidth - 24);
    return fitWidthsIntoViewport(visibleColumns, columnWidths, innerViewport, activeResize?.column);
  }, [enforceNoHorizontalScroll, visibleColumns, tableWrapWidth, columnWidths, activeResize]);
  const hasEditableInVisible = visibleColumns.some((col) => editableColumns.includes(col));
  if (!hasEditableInVisible && editableColumns.length > 0 && visibleColumns.length > 0) {
    visibleColumns[visibleColumns.length - 1] = editableColumns[0];
  }
  const tableTotals = useMemo(() => buildTableTotals(rows, visibleColumns), [rows, visibleColumns]);
  const rowStatusRows = rows.map((row, idx) => {
    const rowOrderRaw = row.row_order;
    const rowOrder = typeof rowOrderRaw === "number" || typeof rowOrderRaw === "string" ? rowOrderRaw : idx;
    const status = getRowBadgeStatus(row, rowOrder);
    const editCount = getRowEditCount(row, rowOrder);
    return {
      rowOrder: String(rowOrder),
      status,
      editCount,
      distributor: String(row["最終經銷商"] ?? row["經銷商"] ?? "(empty)"),
    };
  });
  const editedRows = rowStatusRows.filter((item) => item.status === "edited").length;
  const invalidRows = rowStatusRows.filter((item) => item.status === "invalid").length;
  const revertedRows = rowStatusRows.filter((item) => item.status === "reverted").length;
  const queueRows = rowStatusRows
    .filter((item) => item.editCount > 0 || item.status === "invalid")
    .slice(0, 8)
    .map((item) => ({
      row_order: item.rowOrder,
      經銷商: item.distributor,
      狀態: item.status,
      編修欄位數: item.editCount,
    }));

  return (
    <Panel
      title={`${workflow.toUpperCase()} Rawdata Workspace`}
      subtitle="inline 編修 + dirty feedback + save/modify"
      full
      testId="section-rawdata"
    >
      {workflow === "dsp" ? (
        <>
          <div className="tab-row" role="tablist" aria-label="DSP rawdata view mode" data-testid="dsp-rawdata-view-mode">
            {DSP_RAWDATA_MODE_LABELS.map((item) => (
              <ActionButton
                key={item.value}
                label={item.label}
                testId={item.testId}
                variant={dspViewMode === item.value ? "primary" : "ghost"}
                onClick={() => setDspViewMode(item.value)}
                disabled={busy}
                role="tab"
                ariaSelected={dspViewMode === item.value}
              />
            ))}
          </div>
          <DspRawdataFilterBar
            allRows={allRows}
            filters={dspRawdataFilters}
            rowLimit={rowLimit}
            onDspRawdataFiltersChange={onDspRawdataFiltersChange}
            onRowLimitChange={onRowLimitChange}
          />
        </>
      ) : (
        <FilterBar
          value={rowFilter}
          rowLimit={rowLimit}
          onFilterChange={onFilterChange}
          onRowLimitChange={onRowLimitChange}
        />
      )}
      <div className="status-bar">
        <span>editable_fields: {editableColumns.join(", ") || "none"}</span>
        <span>dirty_rows: {formatNumber(dirtyState.rowCount)}</span>
        <span>has_dirty: {dirtyState.hasDirty ? "yes" : "no"}</span>
        <span>rawdata_mode: {capability.mode === "editable" ? "editable" : "read-only"}</span>
        <span>filter_scope: rawdata_only</span>
      </div>
      {capability.readOnly ? (
        <div className="state-block empty">{capability.readOnlyReason || "目前工作流為 read-only。"}</div>
      ) : null}
      <div className="workflow-cockpit">
        <div className="cockpit-card">
          <h3>編修工作量</h3>
          <div className="metric-list">
            <span>edited_rows: {formatNumber(editedRows)}</span>
            <span>invalid_rows: {formatNumber(invalidRows)}</span>
            <span>reverted_rows: {formatNumber(revertedRows)}</span>
            <span>manual_fields: {formatNumber(editableColumns.length)}</span>
          </div>
        </div>
        <div className="cockpit-card">
          <h3>提交判定</h3>
          <div className="workflow-lanes">
            <div className={`workflow-lane ${hasValidationErrors ? "workflow-lane-active" : "workflow-lane-ready"}`}>
              <strong>型別檢查</strong>
              <span>{hasValidationErrors ? "尚有錯誤待修正" : "已通過"}</span>
            </div>
            <div className={`workflow-lane ${dirtyState.hasDirty ? "workflow-lane-active" : "workflow-lane-waiting"}`}>
              <strong>Modify</strong>
              <span>{dirtyState.hasDirty ? "可提交增量調整" : "目前無增量修改"}</span>
            </div>
            <div className={`workflow-lane ${!hasValidationErrors && rows.length > 0 ? "workflow-lane-ready" : "workflow-lane-waiting"}`}>
              <strong>Save / Export</strong>
              <span>{!hasValidationErrors && rows.length > 0 ? "可進一步存檔/匯出" : "等待資料或修正完成"}</span>
            </div>
          </div>
        </div>
      </div>
      <DataStateBlock loading={busy} empty={!busy && rows.length === 0} />
      {hasValidationErrors ? (
        <div className="state-block error">有型別/格式錯誤，請先修正後再送出 save/modify。</div>
      ) : null}
      {queueRows.length > 0 ? (
        <Panel title="編修隊列" subtitle="優先處理前 8 筆有修改或有錯誤的列。">
          <div className="status-bar">
            <span>queue_size: {formatNumber(queueRows.length)}</span>
            <span>has_validation_errors: {hasValidationErrors ? "yes" : "no"}</span>
            <span>dirty_rows: {formatNumber(dirtyState.rowCount)}</span>
          </div>
          <div className="table-wrap table-wrap-compact">
            <table>
              <thead>
                <tr>
                  <th>row_order</th>
                  <th>經銷商</th>
                  <th>狀態</th>
                  <th>編修欄位數</th>
                </tr>
              </thead>
              <tbody>
                {queueRows.map((row) => (
                  <tr key={String(row.row_order)}>
                    <td>{formatDisplayValue(row.row_order)}</td>
                    <td>{String(row["經銷商"])}</td>
                    <td>{String(row["狀態"])}</td>
                    <td>{formatDisplayValue(row["編修欄位數"])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
      <div
        className={`table-wrap rawdata-table-wrap ${enforceNoHorizontalScroll ? "rawdata-table-wrap-no-scroll" : ""}`}
        data-testid="rawdata-table-wrap"
        ref={tableWrapRef}
      >
        <table
          className={`rawdata-table ${enforceNoHorizontalScroll ? "rawdata-table-fit" : ""}`}
          data-testid="rawdata-table"
        >
          <colgroup>
            {visibleColumns.map((column) => {
              const width = effectiveColumnWidths[column] ?? getColumnWidth(column);
              return <col key={column} style={{ width: `${width}px`, minWidth: `${width}px` }} />;
            })}
          </colgroup>
          <thead>
            <tr>
              {visibleColumns.map((col, idx) => (
                <th key={col}>
                  <div className="rawdata-th-content">
                    <button
                      type="button"
                      className="rawdata-col-resizer rawdata-col-resizer-left"
                      data-testid={`rawdata-col-resizer-${idx}`}
                      aria-label={`${col} 欄寬調整`}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setActiveResize({
                          column: col,
                          startX: event.clientX,
                          startWidth: getColumnWidth(col),
                        });
                      }}
                    />
                    <span className="rawdata-th-label">{col}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!busy && rows.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length} className="table-empty-cell">
                  目前沒有資料列，請先執行 Bootstrap / Refresh Frame 後再編修。
                </td>
              </tr>
            ) : null}
            {rows.map((row, idx) => {
              const rowOrderRaw = row.row_order;
              const rowOrder = typeof rowOrderRaw === "number" || typeof rowOrderRaw === "string" ? rowOrderRaw : idx;
              return (
                <tr key={String(rowOrder)}>
                  {visibleColumns.map((col) => {
                    const base = row[col];
                    if (!editableColumns.includes(col)) {
                      return <td key={`${rowOrder}-${col}`}>{formatDisplayValue(base)}</td>;
                    }
                    const cellError = getCellError(row, col, rowOrder);
                    const inputKind = getColumnInputKind(col);
                    const cellValue = getCellValue(row, col, base, rowOrder);
                    return (
                      <td key={`${rowOrder}-${col}`}>
                        <input
                          value={cellValue}
                          type={inputKind === "number" ? "text" : inputKind === "datetime" ? "text" : "text"}
                          placeholder={inputKind === "datetime" ? "YYYY-MM-DD HH:MM:SS" : undefined}
                          onChange={(e) => onEdit(rowOrder, col, e.target.value)}
                          disabled={busy || !canEditRawdata}
                          className={cellError ? "input-invalid" : ""}
                        />
                        {cellError ? <div className="cell-error">{cellError}</div> : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="table-total-row">
              {visibleColumns.map((col, idx) => {
                const total = tableTotals[col];
                return (
                  <td key={`total-${col}`}>
                    {idx === 0 ? "總計" : total === null ? "" : formatNumber(total)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      <SaveBar
        busy={busy || hasValidationErrors || !canEditRawdata}
        onSave={onSave}
        onModify={onModify}
        saveTestId="action-save"
        modifyTestId="action-modify"
      />
      <div className="btn-row">
        <ActionButton label="Publish (Reserved)" onClick={() => undefined} disabled variant="ghost" testId="action-publish" />
      </div>
      {allowExport ? <ExportBar busy={busy} onExport={onExport} exportTestId="action-export" /> : null}
      <details className="workspace-debug">
        <summary>Debug Payload（非主流程）</summary>
        <div className="grid-2">
          <Field label="Rows JSON (save payload)">
            <textarea value={rowsJson} onChange={(e) => onRowsJsonChange(e.target.value)} disabled={!canEditRawdata} />
          </Field>
          <Field label="Updates JSON (modify payload)">
            <textarea value={updatesJson} onChange={(e) => onUpdatesJsonChange(e.target.value)} disabled={!canEditRawdata} />
          </Field>
        </div>
      </details>
    </Panel>
  );
}
