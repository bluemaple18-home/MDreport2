import type { AriaRole, PropsWithChildren, ReactNode } from "react";
import type { SubView, Workflow } from "../types";
import { formatDisplayValue, formatNumber } from "../utils/format";

type PanelProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
  full?: boolean;
  testId?: string;
  className?: string;
}>;

export function Panel({ title, subtitle, full, children, testId, className }: PanelProps) {
  return (
    <section className={`panel${full ? " panel-full" : ""}${className ? ` ${className}` : ""}`} data-testid={testId}>
      <header className="panel-header">
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

type FieldProps = {
  label: string;
  children: ReactNode;
};

export function Field({ label, children }: FieldProps) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

type ActionButtonProps = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "ghost";
  testId?: string;
  role?: AriaRole;
  ariaSelected?: boolean;
  ariaControls?: string;
  id?: string;
  tabIndex?: number;
};

export function ActionButton({
  label,
  onClick,
  disabled,
  variant = "primary",
  testId,
  role,
  ariaSelected,
  ariaControls,
  id,
  tabIndex,
}: ActionButtonProps) {
  return (
    <button
      type="button"
      className={`btn btn-${variant}${ariaSelected ? " btn-tab-active" : ""}`}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      role={role}
      aria-selected={ariaSelected}
      aria-controls={ariaControls}
      id={id}
      tabIndex={tabIndex}
    >
      {label}
    </button>
  );
}

type JsonCardProps = {
  title: string;
  payload: unknown;
  full?: boolean;
};

export function JsonCard({ title, payload, full }: JsonCardProps) {
  return (
    <Panel title={title} full={full}>
      <pre className="json-view">{JSON.stringify(payload, null, 2)}</pre>
    </Panel>
  );
}

type ShellHeaderProps = {
  healthStatus: string;
  busy: boolean;
};

export function ShellHeader({ healthStatus, busy }: ShellHeaderProps) {
  return (
    <Panel
      title="MDREP Frontend Shell"
      subtitle="SQLite canonical 是唯一真相來源；前端只調度 runtime API，不反寫 artifact。"
      full
    >
      <div className="topline">
        <span className={`badge badge-${healthStatus === "ok" ? "ok" : "warn"}`}>health: {healthStatus}</span>
        <span className={`badge badge-${busy ? "busy" : "idle"}`}>{busy ? "running" : "idle"}</span>
      </div>
    </Panel>
  );
}

type ModeSwitcherProps = {
  workflow: Workflow;
  busy: boolean;
  onChange: (workflow: Workflow) => void;
};

export function ModeSwitcher({ workflow, busy, onChange }: ModeSwitcherProps) {
  return (
    <Panel title={`${workflow.toUpperCase()} Workflow`} subtitle="SSP / DSP 共用同一份 shell 與互動元件實作。">
      <div className="btn-row">
        <ActionButton
          label="Use DSP"
          variant={workflow === "dsp" ? "primary" : "ghost"}
          onClick={() => onChange("dsp")}
          disabled={busy}
        />
        <ActionButton
          label="Use SSP"
          variant={workflow === "ssp" ? "primary" : "ghost"}
          onClick={() => onChange("ssp")}
          disabled={busy}
        />
      </div>
    </Panel>
  );
}

type SubpageSwitcherProps = {
  subView: SubView;
  busy: boolean;
  onChange: (view: SubView) => void;
};

export function SubpageSwitcher({ subView, busy, onChange }: SubpageSwitcherProps) {
  const tabs: SubView[] = ["status", "frame", "result"];
  return (
    <Panel title="Subpages" subtitle="子頁共用同一份元件，僅切換資料與狀態。">
      <div className="btn-row">
        {tabs.map((tab) => (
          <ActionButton
            key={tab}
            label={tab[0].toUpperCase() + tab.slice(1)}
            variant={subView === tab ? "primary" : "ghost"}
            onClick={() => onChange(tab)}
            disabled={busy}
          />
        ))}
      </div>
    </Panel>
  );
}

type FilterBarProps = {
  value: string;
  rowLimit: number;
  onFilterChange: (value: string) => void;
  onRowLimitChange: (value: number) => void;
};

export function FilterBar({ value, rowLimit, onFilterChange, onRowLimitChange }: FilterBarProps) {
  return (
    <div className="filter-bar">
      <Field label="Keyword Filter">
        <input value={value} onChange={(e) => onFilterChange(e.target.value)} placeholder="搜尋欄位值..." />
      </Field>
      <Field label="Row Limit">
        <select value={String(rowLimit)} onChange={(e) => onRowLimitChange(Number(e.target.value))}>
          <option value="20">20</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="200">200</option>
        </select>
      </Field>
    </div>
  );
}

type DataStateBlockProps = {
  loading?: boolean;
  error?: string;
  empty?: boolean;
};

export function DataStateBlock({ loading, error, empty }: DataStateBlockProps) {
  if (loading) {
    return <div className="state-block loading">Loading...</div>;
  }
  if (error) {
    return <div className="state-block error">Error: {error}</div>;
  }
  if (empty) {
    return <div className="state-block empty">No data</div>;
  }
  return null;
}

type TableContainerProps = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  columnFormatters?: Partial<Record<string, (value: unknown) => string>>;
  className?: string;
  footerRows?: Array<Record<string, unknown>>;
};

export function TableContainer({ columns, rows, columnFormatters, className, footerRows }: TableContainerProps) {
  return (
    <div className={`table-wrap${className ? ` ${className}` : ""}`}>
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx}>
              {columns.map((col) => (
                <td key={`${idx}-${col}`}>
                  {columnFormatters?.[col] ? columnFormatters[col]?.(row[col]) ?? "" : formatDisplayValue(row[col])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {Array.isArray(footerRows) && footerRows.length > 0 ? (
          <tfoot>
            {footerRows.map((row, idx) => (
              <tr key={`footer-${idx}`} className="table-total-row">
                {columns.map((col) => (
                  <td key={`footer-${idx}-${col}`}>
                    {columnFormatters?.[col] ? columnFormatters[col]?.(row[col]) ?? "" : formatDisplayValue(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

type StatusBarProps = {
  workflow: Workflow;
  rowCount: number;
  busy: boolean;
};

export function StatusBar({ workflow, rowCount, busy }: StatusBarProps) {
  return (
    <div className="status-bar">
      <span>workflow: {workflow}</span>
      <span>rows: {formatNumber(rowCount)}</span>
      <span>state: {busy ? "running" : "idle"}</span>
    </div>
  );
}

type SaveBarProps = {
  busy: boolean;
  onSave: () => void;
  onModify: () => void;
  saveTestId?: string;
  modifyTestId?: string;
};

export function SaveBar({ busy, onSave, onModify, saveTestId, modifyTestId }: SaveBarProps) {
  return (
    <div className="btn-row save-bar">
      <ActionButton label="Save" onClick={onSave} disabled={busy} testId={saveTestId} />
      <ActionButton label="Modify" onClick={onModify} disabled={busy} variant="secondary" testId={modifyTestId} />
    </div>
  );
}

type ExportBarProps = {
  busy: boolean;
  onExport: () => void;
  exportTestId?: string;
};

export function ExportBar({ busy, onExport, exportTestId }: ExportBarProps) {
  return (
    <div className="btn-row export-bar">
      <ActionButton label="Export" onClick={onExport} disabled={busy} variant="secondary" testId={exportTestId} />
    </div>
  );
}
