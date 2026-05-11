import { useEffect, useMemo, useState } from "react";
import type { RowData } from "../components/workspaces/shared";
import type { DirtyState } from "../types";
import type { RawdataCapability } from "./workflowCapabilities";
import { resolvePostMutationLocalState } from "./rawdataMutationSemantics";

type ColumnInputKind = "text" | "number" | "datetime";

type RawdataMutationAction = "save" | "modify";

type RawdataDispatchAction =
  | { type: "set_updates_json"; value: string }
  | { type: "set_dirty_state"; value: DirtyState }
  | { type: "set_rows_json"; value: string };

type RuntimeDispatch = (action: RawdataDispatchAction) => void;

type RuntimeRunner = (
  action: RawdataMutationAction,
  overrides?: {
    rows?: Array<Record<string, unknown>>;
    updates?: Array<Record<string, unknown>>;
  },
) => Promise<boolean>;

type UseRawdataEditingControllerArgs = {
  allRows: RowData[];
  manualFields: string[];
  rawdataCapability: RawdataCapability;
  dispatch: RuntimeDispatch;
  runAction: RuntimeRunner;
};

function editKey(rowOrder: string | number, column: string): string {
  return `${String(rowOrder)}::${column}`;
}

function parseEditKey(key: string): { rowOrder: string; column: string } {
  const sep = key.indexOf("::");
  if (sep < 0) {
    return { rowOrder: key, column: "" };
  }
  return {
    rowOrder: key.slice(0, sep),
    column: key.slice(sep + 2),
  };
}

function getRowOrder(row: RowData, fallback: string | number): string {
  const raw = row.row_order;
  if (typeof raw === "number" || typeof raw === "string") {
    return String(raw);
  }
  return String(fallback);
}

function isNumericLike(value: unknown): boolean {
  if (value === null || value === undefined || value === "") {
    return true;
  }
  return Number.isFinite(Number(value));
}

function isDateTimeLike(value: unknown): boolean {
  if (value === null || value === undefined || value === "") {
    return true;
  }
  const s = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(s);
}

function validateByKind(kind: ColumnInputKind, value: string): string {
  const normalized = value.trim();
  if (normalized === "") {
    return "";
  }
  if (kind === "number" && !/^-?\d+(\.\d+)?$/.test(normalized)) {
    return "需為數字";
  }
  if (kind === "datetime" && !/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(normalized)) {
    return "格式需為 YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS";
  }
  if (normalized.length > 255) {
    return "超過長度限制（255）";
  }
  return "";
}

export function useRawdataEditingController({
  allRows,
  manualFields,
  rawdataCapability,
  dispatch,
  runAction,
}: UseRawdataEditingControllerArgs) {
  const canEditRawdata = rawdataCapability.canEdit;
  const [rawEdits, setRawEdits] = useState<Record<string, string>>({});
  const [revertedRows, setRevertedRows] = useState<Record<string, boolean>>({});

  const rowLookup = useMemo(() => {
    const lookup = new Map<string, RowData>();
    for (const row of allRows) {
      const raw = row.row_order;
      const key = String(typeof raw === "number" || typeof raw === "string" ? raw : "");
      if (key) {
        lookup.set(key, row);
      }
    }
    return lookup;
  }, [allRows]);

  const columnInputKinds = useMemo<Record<string, ColumnInputKind>>(() => {
    const kinds: Record<string, ColumnInputKind> = {};
    for (const col of manualFields) {
      const samples = allRows
        .map((row) => row[col])
        .filter((v) => v !== null && v !== undefined && String(v).trim() !== "")
        .slice(0, 40);
      const numeric = samples.every((v) => isNumericLike(v));
      const datetime = samples.every((v) => isDateTimeLike(v));
      if (numeric) {
        kinds[col] = "number";
      } else if (datetime) {
        kinds[col] = "datetime";
      } else {
        kinds[col] = "text";
      }
    }
    return kinds;
  }, [allRows, manualFields]);

  const changedEdits = useMemo(() => {
    const changed: Array<{ key: string; rowOrder: string; column: string; value: string }> = [];
    for (const [key, value] of Object.entries(rawEdits)) {
      const parsed = parseEditKey(key);
      if (!parsed.column) {
        continue;
      }
      const baseRow = rowLookup.get(parsed.rowOrder);
      const baseValue = baseRow ? String(baseRow[parsed.column] ?? "") : "";
      if (baseValue === value) {
        continue;
      }
      changed.push({
        key,
        rowOrder: parsed.rowOrder,
        column: parsed.column,
        value,
      });
    }
    return changed;
  }, [rawEdits, rowLookup]);

  const editErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const edit of changedEdits) {
      const kind = columnInputKinds[edit.column] || "text";
      const message = validateByKind(kind, edit.value);
      if (message) {
        errors[edit.key] = message;
      }
    }
    return errors;
  }, [changedEdits, columnInputKinds]);

  const hasValidationErrors = useMemo(() => Object.keys(editErrors).length > 0, [editErrors]);

  const buildUpdatesPayload = useMemo(() => {
    const updates: Array<Record<string, unknown>> = [];
    for (const edit of changedEdits) {
      if (editErrors[edit.key]) {
        continue;
      }
      const rowOrderNum = Number(edit.rowOrder);
      updates.push({
        row_order: Number.isFinite(rowOrderNum) ? rowOrderNum : edit.rowOrder,
        column: edit.column,
        value: edit.value,
      });
    }
    return updates;
  }, [changedEdits, editErrors]);

  const buildRowsPayload = useMemo(() => {
    const cloned = allRows.map((row) => ({ ...row }));
    const byRow = new Map<string, Record<string, unknown>>();
    for (const row of cloned) {
      const rowOrder = row.row_order;
      const key = String(typeof rowOrder === "number" || typeof rowOrder === "string" ? rowOrder : "");
      if (key) {
        byRow.set(key, row);
      }
    }
    for (const edit of changedEdits) {
      const parsed = parseEditKey(edit.key);
      const target = byRow.get(parsed.rowOrder);
      if (!target || !parsed.column) {
        continue;
      }
      target[parsed.column] = edit.value;
    }
    return cloned;
  }, [allRows, changedEdits]);

  useEffect(() => {
    const updatesJson = JSON.stringify(buildUpdatesPayload);
    dispatch({ type: "set_updates_json", value: updatesJson });
    const dirtyRows = new Set(changedEdits.map((edit) => edit.rowOrder));
    dispatch({
      type: "set_dirty_state",
      value: {
        rowCount: dirtyRows.size,
        manualOverrideCount: changedEdits.length,
        hasDirty: changedEdits.length > 0,
        lastTouchedAt: changedEdits.length > 0 ? new Date().toISOString() : "",
      },
    });
  }, [buildUpdatesPayload, changedEdits, dispatch]);

  useEffect(() => {
    if (!canEditRawdata) {
      setRawEdits({});
      setRevertedRows({});
    }
  }, [canEditRawdata]);

  function handleEdit(rowOrder: string | number, column: string, value: string): void {
    if (!canEditRawdata) {
      return;
    }
    if (!manualFields.includes(column)) {
      return;
    }
    setRawEdits((prev) => ({
      ...prev,
      [editKey(rowOrder, column)]: value,
    }));
    setRevertedRows((prev) => {
      const next = { ...prev };
      delete next[String(rowOrder)];
      return next;
    });
  }

  function handleRevertCell(rowOrder: string | number, column: string): void {
    if (!canEditRawdata) {
      return;
    }
    const key = editKey(rowOrder, column);
    setRawEdits((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setRevertedRows((prev) => ({
      ...prev,
      [String(rowOrder)]: true,
    }));
  }

  function handleClearRowEdits(rowOrder: string | number): void {
    if (!canEditRawdata) {
      return;
    }
    const rowKey = String(rowOrder);
    const prefix = `${rowKey}::`;
    setRawEdits((prev) => {
      const next: Record<string, string> = {};
      for (const [key, value] of Object.entries(prev)) {
        if (!key.startsWith(prefix)) {
          next[key] = value;
        }
      }
      return next;
    });
    setRevertedRows((prev) => ({
      ...prev,
      [rowKey]: true,
    }));
  }

  function getCellValue(row: RowData, column: string, fallback: unknown, rowOrderFallback?: string | number): string {
    const rowOrderRaw = row.row_order;
    const rowOrder = typeof rowOrderRaw === "number" || typeof rowOrderRaw === "string"
      ? rowOrderRaw
      : rowOrderFallback ?? "";
    if (rowOrder === "" || rowOrder === null || rowOrder === undefined) {
      return String(fallback ?? "");
    }
    const key = editKey(rowOrder, column);
    if (key in rawEdits) {
      return rawEdits[key] ?? "";
    }
    return String(fallback ?? "");
  }

  function getCellError(row: RowData, column: string, rowOrderFallback?: string | number): string {
    const rowOrder = getRowOrder(row, rowOrderFallback ?? "");
    if (!rowOrder) {
      return "";
    }
    return editErrors[editKey(rowOrder, column)] || "";
  }

  function isCellEdited(row: RowData, column: string, rowOrderFallback?: string | number): boolean {
    const rowOrder = getRowOrder(row, rowOrderFallback ?? "");
    if (!rowOrder) {
      return false;
    }
    const key = editKey(rowOrder, column);
    return changedEdits.some((edit) => edit.key === key);
  }

  function getColumnInputKind(column: string): ColumnInputKind {
    return columnInputKinds[column] || "text";
  }

  function getRowEditCount(row: RowData, rowOrderFallback?: string | number): number {
    const rowOrder = getRowOrder(row, rowOrderFallback ?? "");
    if (!rowOrder) {
      return 0;
    }
    return changedEdits.filter((edit) => edit.rowOrder === rowOrder).length;
  }

  function getRowBadgeStatus(row: RowData, rowOrderFallback?: string | number): "clean" | "edited" | "invalid" | "reverted" {
    const rowOrder = getRowOrder(row, rowOrderFallback ?? "");
    if (!rowOrder) {
      return "clean";
    }
    const rowEdits = changedEdits.filter((edit) => edit.rowOrder === rowOrder);
    if (rowEdits.some((edit) => !!editErrors[edit.key])) {
      return "invalid";
    }
    if (rowEdits.length > 0) {
      return "edited";
    }
    if (revertedRows[rowOrder]) {
      return "reverted";
    }
    return "clean";
  }

  async function handleSave(): Promise<void> {
    if (!canEditRawdata) {
      return;
    }
    if (hasValidationErrors) {
      return;
    }
    const rowsPayload = buildRowsPayload;
    dispatch({ type: "set_rows_json", value: JSON.stringify(rowsPayload) });
    const ok = await runAction("save", { rows: rowsPayload });
    const next = resolvePostMutationLocalState(ok, rawEdits, revertedRows);
    if (next.cleared) {
      setRawEdits(next.rawEdits);
      setRevertedRows(next.revertedRows);
    }
  }

  async function handleModify(): Promise<void> {
    if (!canEditRawdata) {
      return;
    }
    if (hasValidationErrors) {
      return;
    }
    const ok = await runAction("modify", { updates: buildUpdatesPayload });
    const next = resolvePostMutationLocalState(ok, rawEdits, revertedRows);
    if (next.cleared) {
      setRawEdits(next.rawEdits);
      setRevertedRows(next.revertedRows);
    }
  }

  return {
    hasValidationErrors,
    handleSave,
    handleModify,
    handleEdit,
    handleRevertCell,
    handleClearRowEdits,
    getCellValue,
    getCellError,
    isCellEdited,
    getColumnInputKind,
    getRowBadgeStatus,
    getRowEditCount,
  };
}
