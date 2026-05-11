export type RowData = Record<string, unknown>;

export type RecentMap = {
  runLog: Array<Record<string, unknown>>;
  publishRuns: Array<Record<string, unknown>>;
  evidenceIndex: Array<Record<string, unknown>>;
};

export function textOf(value: unknown, fallback = ""): string {
  const raw = String(value ?? "").trim();
  return raw || fallback;
}

export function compactPath(pathValue: unknown): string {
  const pathText = textOf(pathValue, "n/a");
  if (pathText === "n/a") {
    return pathText;
  }
  const chunks = pathText.split("/");
  return chunks[chunks.length - 1] || pathText;
}

export function numValue(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const raw = String(value ?? "").trim();
  if (!raw) {
    return 0;
  }
  const negativeByParen = raw.startsWith("(") && raw.endsWith(")");
  const normalized = raw
    .replace(/[,$\s]/g, "")
    .replace(/[()]/g, "")
    .replace(/%/g, "");
  const n = Number(normalized);
  if (!Number.isFinite(n)) {
    return 0;
  }
  if (negativeByParen) {
    return -Math.abs(n);
  }
  return Number.isFinite(n) ? n : 0;
}

export function isSummableCell(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  const raw = String(value ?? "").trim();
  if (!raw) {
    return false;
  }
  if (!/^[\d,.$%\s()+\-]+$/.test(raw)) {
    return false;
  }
  return Number.isFinite(numValue(raw));
}
