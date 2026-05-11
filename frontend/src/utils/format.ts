const NUMBER_FORMAT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function parseNumericValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.replace(/,/g, "");
  if (!/^[+-]?\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatNumber(value: unknown): string {
  const parsed = parseNumericValue(value);
  if (parsed === null) {
    return String(value ?? "");
  }
  return NUMBER_FORMAT.format(parsed);
}

export function formatAmount(value: unknown): string {
  const parsed = parseNumericValue(value);
  if (parsed === null) {
    return String(value ?? "");
  }
  if (parsed === 0) {
    return "0";
  }
  return NUMBER_FORMAT.format(parsed);
}

export function formatPercent(value: unknown): string {
  const parsed = parseNumericValue(value);
  if (parsed === null) {
    return String(value ?? "");
  }
  return `${NUMBER_FORMAT.format(parsed)}%`;
}

export function formatDisplayValue(value: unknown): string {
  return formatNumber(value);
}
