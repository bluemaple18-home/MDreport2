import type { RowData } from "../components/workspaces/shared";
import type { DspDateBucket, DspRawdataFilters } from "../types";

export type DspFacetOption = {
  value: string;
  label: string;
};

export type DspDateOption = {
  value: DspDateBucket;
  label: string;
  weekStart: string;
  weekEnd: string;
};

const DATE_BUCKET_ORDER: Array<{ value: DspDateBucket; label: string; weeksAgo: number }> = [
  { value: "last_week", label: "上週", weeksAgo: 1 },
  { value: "two_weeks_ago", label: "上上週", weeksAgo: 2 },
  { value: "three_weeks_ago", label: "上上上週", weeksAgo: 3 },
  { value: "four_weeks_ago", label: "上上上上週", weeksAgo: 4 },
];

export const defaultDspRawdataFilters: DspRawdataFilters = {
  dateBucket: "last_week",
  distributor: "",
  adFormat: "",
  size: "",
  template: "",
};

function toIsoDate(value: Date): string {
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  const dd = String(value.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function startOfWeek(reference: Date): Date {
  const start = new Date(reference);
  const day = start.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + mondayOffset);
  return start;
}

function buildWeekRange(weeksAgo: number, reference = new Date()): { weekStart: string; weekEnd: string } {
  const baseStart = startOfWeek(reference);
  const start = new Date(baseStart);
  start.setDate(start.getDate() - weeksAgo * 7);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return {
    weekStart: toIsoDate(start),
    weekEnd: toIsoDate(end),
  };
}

function getWeekRangeByBucket(bucket: DspDateBucket, reference = new Date()): { weekStart: string; weekEnd: string } {
  const match = DATE_BUCKET_ORDER.find((item) => item.value === bucket);
  if (!match) {
    return buildWeekRange(1, reference);
  }
  return buildWeekRange(match.weeksAgo, reference);
}

function extractDateKey(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  return raw.length >= 10 ? raw.slice(0, 10) : raw;
}

function normalizeFacetValue(value: unknown): string {
  return String(value ?? "").trim();
}

function getFacetValue(row: RowData, field: "distributor" | "adFormat" | "size" | "template"): string {
  if (field === "distributor") {
    return normalizeFacetValue(row["最終經銷商"] ?? row["經銷商"]);
  }
  if (field === "adFormat") {
    return normalizeFacetValue(row["最終廣告形式"] ?? row["廣告形式"]);
  }
  if (field === "size") {
    return normalizeFacetValue(row["尺寸"]);
  }
  return normalizeFacetValue(row["素材樣板"]);
}

export function buildDspDateOptions(reference = new Date()): DspDateOption[] {
  return DATE_BUCKET_ORDER.map((bucket) => {
    const range = buildWeekRange(bucket.weeksAgo, reference);
    return {
      value: bucket.value,
      label: `${bucket.label}（${range.weekStart} ~ ${range.weekEnd}）`,
      weekStart: range.weekStart,
      weekEnd: range.weekEnd,
    };
  });
}

export function collectDspFacetOptions(
  rows: RowData[],
  field: "distributor" | "adFormat" | "size" | "template",
): DspFacetOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = getFacetValue(row, field);
    if (!value) {
      continue;
    }
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0], "zh-Hant");
    })
    .map(([value]) => ({ value, label: value }));
}

function rowMatchesDateBucket(row: RowData, bucket: DspDateBucket, reference = new Date()): boolean {
  const dateKey = extractDateKey(row["日期時間"]);
  if (!dateKey) {
    return false;
  }
  const option = getWeekRangeByBucket(bucket, reference);
  return dateKey >= option.weekStart && dateKey <= option.weekEnd;
}

export function hasDspRowsInDateBucket(rows: RowData[], bucket: DspDateBucket, reference = new Date()): boolean {
  return rows.some((row) => rowMatchesDateBucket(row, bucket, reference));
}

export function filterDspRawdataRows(
  rows: RowData[],
  filters: DspRawdataFilters,
  rowLimit: number,
  reference = new Date(),
): RowData[] {
  return rows
    .filter((row) => rowMatchesDateBucket(row, filters.dateBucket, reference))
    .filter((row) => {
      const distributor = getFacetValue(row, "distributor");
      return !filters.distributor || distributor === filters.distributor;
    })
    .filter((row) => {
      const adFormat = getFacetValue(row, "adFormat");
      return !filters.adFormat || adFormat === filters.adFormat;
    })
    .filter((row) => {
      const size = getFacetValue(row, "size");
      return !filters.size || size === filters.size;
    })
    .filter((row) => {
      const template = getFacetValue(row, "template");
      return !filters.template || template === filters.template;
    })
    .slice(0, rowLimit);
}

export function resolvePreferredDspDateBucket(rows: RowData[], reference = new Date()): DspDateBucket {
  for (const bucket of DATE_BUCKET_ORDER) {
    if (hasDspRowsInDateBucket(rows, bucket.value, reference)) {
      return bucket.value;
    }
  }
  return defaultDspRawdataFilters.dateBucket;
}
