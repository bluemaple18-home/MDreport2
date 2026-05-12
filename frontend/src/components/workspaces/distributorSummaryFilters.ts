import type { RowData } from "./shared";

const EXCLUDED_DISTRIBUTOR_KEYWORDS: string[] = ["pm", "rd", "qa", "測試"];

function textOf(value: unknown, fallback = ""): string {
  const raw = String(value ?? "").trim();
  return raw || fallback;
}

export function isExcludedSummaryDistributor(distributorValue: unknown): boolean {
  const distributor = textOf(distributorValue, "").toLowerCase();
  if (!distributor) {
    return false;
  }
  if (distributor.includes("測試")) {
    return true;
  }
  const asciiTokens: string[] = distributor.match(/[a-z0-9]+/g) ?? [];
  return EXCLUDED_DISTRIBUTOR_KEYWORDS.some((keyword) => asciiTokens.includes(keyword));
}

export function getSummaryDistributor(row: RowData): string {
  return textOf(row["最終經銷商"] ?? row["經銷商"], "(empty)");
}

export function filterSummaryRows(rows: RowData[]): RowData[] {
  return rows.filter((row) => !isExcludedSummaryDistributor(getSummaryDistributor(row)));
}

function numValue(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const normalized = String(value ?? "").trim().replace(/[,$\s]/g, "");
  const numberValue = Number(normalized);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

export function resolveExcludedSummaryReason(distributorValue: unknown): string {
  const distributor = textOf(distributorValue, "").toLowerCase();
  const reasons: string[] = [];
  if (distributor.includes("測試")) {
    reasons.push("測試");
  }
  const asciiTokens: string[] = distributor.match(/[a-z0-9]+/g) ?? [];
  for (const keyword of ["pm", "rd", "qa"]) {
    if (asciiTokens.includes(keyword)) {
      reasons.push(keyword.toUpperCase());
    }
  }
  return reasons.join(" / ") || "n/a";
}

export function summarizeExcludedSummaryRows(rows: RowData[]): RowData[] {
  const summary = new Map<string, { reason: string; count: number; amount: number }>();
  for (const row of rows) {
    const distributor = getSummaryDistributor(row);
    if (!isExcludedSummaryDistributor(distributor)) {
      continue;
    }
    const current = summary.get(distributor) ?? {
      reason: resolveExcludedSummaryReason(distributor),
      count: 0,
      amount: 0,
    };
    current.count += 1;
    current.amount += numValue(row["執行金額"]);
    summary.set(distributor, current);
  }
  return Array.from(summary.entries())
    .map(([distributor, item]) => ({
      經銷商: distributor,
      排除原因: item.reason,
      筆數: item.count,
      執行金額: item.amount,
    }))
    .sort((a, b) => Number(b["執行金額"]) - Number(a["執行金額"]));
}
