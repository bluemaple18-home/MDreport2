export type SspParitySupplierAnomaly = {
  anomalyDayCount: number;
  anomalySiteCount: number;
  latestDateAnomaly: boolean;
};

export function isSupplierLevelAnomaly(summary: SspParitySupplierAnomaly): boolean {
  return summary.latestDateAnomaly;
}

export function isLatestDateAnomaly(
  anomalyDates: Record<string, boolean>,
  latestDate: string,
): boolean {
  return Boolean(anomalyDates[latestDate]);
}

export function isAsciiDigitInput(value: string): boolean {
  return /^[0-9]*$/.test(value);
}

export function normalizeAsciiDigitInput(value: string): string {
  const digits = Array.from(value).filter((char) => isAsciiDigitInput(char)).join("");
  return digits.replace(/^0+(?=\d)/, "");
}

export function filterSupplierSummaries<T extends SspParitySupplierAnomaly>(mode: "all" | "anomaly", summaries: T[]): T[] {
  if (mode === "all") {
    return summaries;
  }
  return summaries.filter(isSupplierLevelAnomaly);
}
