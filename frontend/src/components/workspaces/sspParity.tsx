import { Fragment, useEffect, useMemo, useState } from "react";
import type { Workflow } from "../../types";
import { DataStateBlock, Field, Panel } from "../ui";
import type { RowData } from "./shared";
import { numValue } from "./shared";
import { formatAmount, formatNumber, formatPercent } from "../../utils/format";
import {
  filterSupplierSummaries,
  isAsciiDigitInput,
  isLatestDateAnomaly,
  isSupplierLevelAnomaly,
  normalizeAsciiDigitInput,
} from "./sspParityRules";

type SspParityWorkspaceProps = {
  rows: RowData[];
  excludingPaddingRows: RowData[];
  paddingScope?: {
    default: "including_padding" | "excluding_padding";
    including_row_count: number;
    excluding_row_count: number;
  };
  workflow: Workflow;
  busy: boolean;
};

type DailyMetric = {
  requests: number;
  impressions: number;
  clicks: number;
  revenue: number;
  dspAmount: number;
};

type SiteDrilldownItem = {
  siteKey: string;
  latestRequests: number;
  dodDeltaRequests: number;
  contribution: number;
  status: "normal" | "high" | "medium";
  reason: string;
};

type SupplierSummary = {
  supplier: string;
  anomalyDayCount: number;
  anomalySiteCount: number;
  latestDateAnomaly: boolean;
  latestDodDeltaRequests: number;
  latestRequests: number;
  dailyMetrics: Record<string, DailyMetric>;
  anomalyDates: Record<string, boolean>;
  performanceAnomalyDates: Record<string, Record<TrendMetricKey, boolean>>;
  siteDrilldown: SiteDrilldownItem[];
};

type VisibilityMode = "all" | "anomaly";
type PaddingScope = "including_padding" | "excluding_padding";
type TrendMetricKey = "cpc" | "cpm" | "ctr";
type TrendBarMetricKey = "requests" | "impressions";
type TrendComparisonGroupKey = "top" | "rest";
type DailyTableMode = "traffic" | "performance";

type TrendComparisonDaily = {
  date: string;
  top: DailyMetric;
  rest: DailyMetric;
  topLineValue: number;
  restLineValue: number;
};

const TREND_METRICS: Array<{ key: TrendMetricKey; label: string; format: (value: number) => string }> = [
  { key: "cpc", label: "CPC", format: formatAmount },
  { key: "cpm", label: "CPM", format: formatAmount },
  { key: "ctr", label: "CTR", format: formatPercent },
];

const TREND_BAR_METRICS: Array<{ key: TrendBarMetricKey; label: string }> = [
  { key: "requests", label: "請求" },
  { key: "impressions", label: "曝光" },
];

const DAILY_TABLE_MODES: Array<{ key: DailyTableMode; label: string }> = [
  { key: "traffic", label: "流量" },
  { key: "performance", label: "成效" },
];

const PERFORMANCE_METRIC_KEYS: TrendMetricKey[] = ["cpc", "cpm", "ctr"];

const DOD_THRESHOLD_MILLION = 500;
const PERFORMANCE_DOD_THRESHOLD_PERCENT = 10;
function normalizeSupplier(row: RowData): string {
  return String(row["supplier_name"] ?? "未分類供應商").trim() || "未分類供應商";
}

function normalizeSiteKey(row: RowData): string {
  return String(row["site_name"] ?? row["placement_name"] ?? "未命名網站").trim() || "未命名網站";
}

function normalizeDateKey(row: RowData): string {
  const raw = String(row["date"] ?? row["ts"] ?? "").trim();
  if (!raw) {
    return "n/a";
  }
  return raw.length >= 10 ? raw.slice(0, 10) : raw;
}

function resolveRequestCount(row: RowData): number {
  return numValue(row["request"]);
}

function resolveImpressionCount(row: RowData): number {
  return numValue(row["impression"]);
}

function resolveClickCount(row: RowData): number {
  return numValue(row["clicks"]);
}

function resolveRevenue(row: RowData): number {
  return numValue(row["revenue"] ?? row["profit"]);
}

function resolveDspAmount(row: RowData): number {
  return numValue(row["dsp_amount"] ?? row["advertiser_mu"]);
}

function emptyDailyMetric(): DailyMetric {
  return { requests: 0, impressions: 0, clicks: 0, revenue: 0, dspAmount: 0 };
}

function addRowToDailyMetric(target: DailyMetric, row: RowData): void {
  target.requests += resolveRequestCount(row);
  target.impressions += resolveImpressionCount(row);
  target.clicks += resolveClickCount(row);
  target.revenue += resolveRevenue(row);
  target.dspAmount += resolveDspAmount(row);
}

function trendMetricValue(metric: DailyMetric, key: TrendMetricKey): number {
  if (key === "ctr") {
    return metric.impressions > 0 ? (metric.clicks / metric.impressions) * 100 : 0;
  }
  if (key === "cpm") {
    return metric.impressions > 0 ? (metric.revenue / metric.impressions) * 1000 : 0;
  }
  return metric.clicks > 0 ? metric.revenue / metric.clicks : 0;
}

function isPerformanceDodAnomaly(today: number, previous: number, thresholdPercent: number): boolean {
  if (previous === 0) {
    return today !== 0;
  }
  return Math.abs(((today - previous) / Math.abs(previous)) * 100) >= thresholdPercent;
}

function dailyTableHeaders(mode: DailyTableMode): string[] {
  if (mode === "performance") {
    return ["CPC", "CPM", "CTR"];
  }
  return ["請求", "曝光", "FR(%)"];
}

function dailyTableValues(metric: DailyMetric, mode: DailyTableMode): string[] {
  if (mode === "performance") {
    return [
      formatAmount(trendMetricValue(metric, "cpc")),
      formatAmount(trendMetricValue(metric, "cpm")),
      formatPercent(trendMetricValue(metric, "ctr")),
    ];
  }
  const fr = metric.requests > 0 ? (metric.impressions / metric.requests) * 100 : 0;
  return [formatNumber(metric.requests), formatNumber(metric.impressions), formatPercent(fr)];
}

function toMillionUnits(value: number): number {
  return value / 10000;
}

function buildReason(
  status: "normal" | "high" | "medium",
  dodDeltaRequests: number,
  latestRequests: number,
  dodThresholdMillion: number,
): string {
  if (status === "normal") {
    return `波動低於 ${dodThresholdMillion} 萬閾值`;
  }
  if (latestRequests <= 0) {
    return "當日請求為 0";
  }
  const changeInMillion = formatNumber(toMillionUnits(Math.abs(dodDeltaRequests)));
  if (dodDeltaRequests >= 0) {
    return `請求較前日增加 ${changeInMillion} 萬`;
  }
  return `請求較前日下降 ${changeInMillion} 萬`;
}

function SspAnomalyTrendChart({
  rows,
  datesAsc,
  barMetric,
  metric,
}: {
  rows: RowData[];
  datesAsc: string[];
  barMetric: TrendBarMetricKey;
  metric: TrendMetricKey;
}) {
  const metricConfig = TREND_METRICS.find((item) => item.key === metric) || TREND_METRICS[0];
  const barMetricConfig = TREND_BAR_METRICS.find((item) => item.key === barMetric) || TREND_BAR_METRICS[0];
  const trendData = useMemo(() => {
    const supplierTotals = new Map<string, number>();
    for (const row of rows) {
      const date = normalizeDateKey(row);
      if (!datesAsc.includes(date)) {
        continue;
      }
      const supplier = normalizeSupplier(row);
      supplierTotals.set(supplier, (supplierTotals.get(supplier) ?? 0) + resolveRequestCount(row));
    }

    const topSupplier = Array.from(supplierTotals.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "第一大供應商";
    const byDate = new Map<string, { top: DailyMetric; rest: DailyMetric }>();
    for (const date of datesAsc) {
      byDate.set(date, { top: emptyDailyMetric(), rest: emptyDailyMetric() });
    }
    for (const row of rows) {
      const date = normalizeDateKey(row);
      if (!byDate.has(date)) {
        continue;
      }
      const current = byDate.get(date) || { top: emptyDailyMetric(), rest: emptyDailyMetric() };
      const group: TrendComparisonGroupKey = normalizeSupplier(row) === topSupplier ? "top" : "rest";
      addRowToDailyMetric(current[group], row);
      byDate.set(date, current);
    }
    const daily = datesAsc.map((date): TrendComparisonDaily => {
      const item = byDate.get(date) || { top: emptyDailyMetric(), rest: emptyDailyMetric() };
      return {
        date,
        top: item.top,
        rest: item.rest,
        topLineValue: trendMetricValue(item.top, metric),
        restLineValue: trendMetricValue(item.rest, metric),
      };
    });
    return { topSupplier, daily };
  }, [datesAsc, metric, rows]);

  const { topSupplier, daily } = trendData;
  const latest = daily[daily.length - 1];
  const getBarValue = (metricItem: DailyMetric) => metricItem[barMetric];
  const maxBarValue = Math.max(...daily.flatMap((item) => [getBarValue(item.top), getBarValue(item.rest)]), 1);
  const maxLine = Math.max(...daily.flatMap((item) => [item.topLineValue, item.restLineValue]), 1);
  const width = 780;
  const height = 210;
  const left = 82;
  const right = 56;
  const top = 18;
  const bottom = 38;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const barSlot = plotWidth / Math.max(daily.length, 1);
  const barWidth = Math.max(5, Math.min(14, barSlot * 0.24));
  const barGap = Math.max(3, Math.min(6, barSlot * 0.08));
  const buildLinePoints = (group: TrendComparisonGroupKey) => daily.map((item, index) => {
    const x = left + (daily.length <= 1 ? plotWidth / 2 : (index / (daily.length - 1)) * plotWidth);
    const lineValue = group === "top" ? item.topLineValue : item.restLineValue;
    const y = top + plotHeight - (lineValue / maxLine) * plotHeight;
    return { ...item, x, y };
  });
  const topLinePoints = buildLinePoints("top");
  const restLinePoints = buildLinePoints("rest");
  const yTicks = [1, 0.75, 0.5, 0.25, 0].map((ratio) => ({
    ratio,
    y: top + plotHeight * (1 - ratio),
    barValue: maxBarValue * ratio,
    lineValue: maxLine * ratio,
  }));

  return (
    <div className="ssp-anomaly-trend-chart" data-testid="ssp-anomaly-trend-chart">
      <div className="ssp-anomaly-trend-head">
        <span>第一大供應商：{topSupplier}</span>
        <span>柱狀：{barMetricConfig.label}　折線：{metricConfig.label}</span>
        {latest ? (
          <span>
            {latest.date}｜第一大{barMetricConfig.label} {formatNumber(getBarValue(latest.top))}｜剩餘{barMetricConfig.label} {formatNumber(getBarValue(latest.rest))}
          </span>
        ) : null}
        {latest ? (
          <span>
            {metricConfig.label} 第一大 {metricConfig.format(latest.topLineValue)}｜剩餘 {metricConfig.format(latest.restLineValue)}
          </span>
        ) : null}
      </div>
      <svg
        className="ssp-anomaly-trend-svg"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`近 15 天第一大供應商與剩餘供應商${barMetricConfig.label}及 ${metricConfig.label} 比較趨勢`}
      >
        <line x1={left} x2={width - right} y1={top + plotHeight} y2={top + plotHeight} className="ad-group-chart-axis" />
        <line x1={left} x2={left} y1={top} y2={top + plotHeight} className="ad-group-chart-axis" />
        <line x1={width - right} x2={width - right} y1={top} y2={top + plotHeight} className="ad-group-chart-axis" />
        {yTicks.map((tick, index) => (
          <Fragment key={`trend-grid-${index}`}>
            <line x1={left} x2={width - right} y1={tick.y} y2={tick.y} className="ad-group-chart-grid-horizontal" />
            <text x={left - 8} y={tick.y + 4} textAnchor="end" className="ssp-anomaly-trend-axis-text">
              {formatNumber(tick.barValue)}
            </text>
            <text x={width - right + 8} y={tick.y + 4} textAnchor="start" className="ssp-anomaly-trend-axis-text">
              {metricConfig.format(tick.lineValue)}
            </text>
          </Fragment>
        ))}
        {daily.flatMap((point, index) => {
          const slotX = left + index * barSlot;
          const groupWidth = barWidth * 2 + barGap;
          const topX = slotX + (barSlot - groupWidth) / 2;
          const restX = topX + barWidth + barGap;
          const topBarValue = getBarValue(point.top);
          const restBarValue = getBarValue(point.rest);
          const topBarHeight = (topBarValue / maxBarValue) * plotHeight;
          const restBarHeight = (restBarValue / maxBarValue) * plotHeight;
          return (
            <Fragment key={`request-bars-${point.date}`}>
              <rect
                x={topX}
                y={top + plotHeight - topBarHeight}
                width={barWidth}
                height={topBarHeight}
                rx={2}
                className="ssp-anomaly-trend-bar ssp-anomaly-trend-bar-top"
              >
                <title>{`${point.date} ${topSupplier} ${barMetricConfig.label}: ${formatNumber(topBarValue)}`}</title>
              </rect>
              <rect
                x={restX}
                y={top + plotHeight - restBarHeight}
                width={barWidth}
                height={restBarHeight}
                rx={2}
                className="ssp-anomaly-trend-bar ssp-anomaly-trend-bar-rest"
              >
                <title>{`${point.date} 剩餘供應商 ${barMetricConfig.label}: ${formatNumber(restBarValue)}`}</title>
              </rect>
            </Fragment>
          );
        })}
        <polyline points={topLinePoints.map((point) => `${point.x},${point.y}`).join(" ")} className="ssp-anomaly-trend-line ssp-anomaly-trend-line-top" />
        <polyline points={restLinePoints.map((point) => `${point.x},${point.y}`).join(" ")} className="ssp-anomaly-trend-line ssp-anomaly-trend-line-rest" />
        {topLinePoints.map((point) => (
          <circle key={`line-node-top-${point.date}`} cx={point.x} cy={point.y} r={4} className="ssp-anomaly-trend-node ssp-anomaly-trend-node-top">
            <title>{`${point.date} ${topSupplier} ${metricConfig.label}: ${metricConfig.format(point.topLineValue)}`}</title>
          </circle>
        ))}
        {restLinePoints.map((point) => (
          <circle key={`line-node-rest-${point.date}`} cx={point.x} cy={point.y} r={3.5} className="ssp-anomaly-trend-node ssp-anomaly-trend-node-rest">
            <title>{`${point.date} 剩餘供應商 ${metricConfig.label}: ${metricConfig.format(point.restLineValue)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="ssp-anomaly-trend-x-axis" style={{ gridTemplateColumns: `repeat(${daily.length || 1}, minmax(0, 1fr))` }}>
        {daily.map((item) => (
          <span key={`trend-date-${item.date}`}>{item.date.slice(5)}</span>
        ))}
      </div>
      <div className="ssp-anomaly-trend-legend">
        <span><i className="legend-request legend-request-top" />第一大{barMetricConfig.label}</span>
        <span><i className="legend-request legend-request-rest" />剩餘{barMetricConfig.label}</span>
        <span><i className="legend-line legend-line-top" />第一大 {metricConfig.label}</span>
        <span><i className="legend-line legend-line-rest" />剩餘 {metricConfig.label}</span>
      </div>
    </div>
  );
}

export function SspParityWorkspace({ rows, excludingPaddingRows, paddingScope, workflow, busy }: SspParityWorkspaceProps) {
  const [visibilityMode, setVisibilityMode] = useState<VisibilityMode>("all");
  const [selectedPaddingScope, setSelectedPaddingScope] = useState<PaddingScope>("including_padding");
  const [trendBarMetric, setTrendBarMetric] = useState<TrendBarMetricKey>("impressions");
  const [trendMetric, setTrendMetric] = useState<TrendMetricKey>("cpc");
  const [dailyTableMode, setDailyTableMode] = useState<DailyTableMode>("traffic");
  const [dodThresholdInput, setDodThresholdInput] = useState<string>(String(DOD_THRESHOLD_MILLION));
  const [performanceDodThresholdInput, setPerformanceDodThresholdInput] = useState<string>(String(PERFORMANCE_DOD_THRESHOLD_PERCENT));
  const [expandedSupplier, setExpandedSupplier] = useState<string | null>(null);
  const dodThresholdMillion = Number(dodThresholdInput || 0);
  const performanceDodThresholdPercent = Number(performanceDodThresholdInput || 0);
  const effectiveRows = selectedPaddingScope === "excluding_padding" ? excludingPaddingRows : rows;
  const selectedRowCount = selectedPaddingScope === "excluding_padding"
    ? paddingScope?.excluding_row_count ?? excludingPaddingRows.length
    : paddingScope?.including_row_count ?? rows.length;
  const dailyHeaders = dailyTableHeaders(dailyTableMode);

  const anomalyWorkbench = useMemo(() => {
    const supplierDaily = new Map<string, Map<string, DailyMetric>>();
    const supplierSiteDaily = new Map<string, Map<string, Map<string, DailyMetric>>>();
    const allDateKeys = new Set<string>();

    for (const row of effectiveRows) {
      const supplier = normalizeSupplier(row);
      const siteKey = normalizeSiteKey(row);
      const dateKey = normalizeDateKey(row);
      allDateKeys.add(dateKey);

      const dailyMap = supplierDaily.get(supplier) ?? new Map<string, DailyMetric>();
      const dailyItem = dailyMap.get(dateKey) ?? emptyDailyMetric();
      addRowToDailyMetric(dailyItem, row);
      dailyMap.set(dateKey, dailyItem);
      supplierDaily.set(supplier, dailyMap);

      const siteMap = supplierSiteDaily.get(supplier) ?? new Map<string, Map<string, DailyMetric>>();
      const siteDailyMap = siteMap.get(siteKey) ?? new Map<string, DailyMetric>();
      const siteDailyItem = siteDailyMap.get(dateKey) ?? emptyDailyMetric();
      addRowToDailyMetric(siteDailyItem, row);
      siteDailyMap.set(dateKey, siteDailyItem);
      siteMap.set(siteKey, siteDailyMap);
      supplierSiteDaily.set(supplier, siteMap);
    }

    const dateKeysAsc = Array.from(allDateKeys.values()).sort().slice(-30);
    const dateKeysDesc = [...dateKeysAsc].reverse();
    const latestDate = dateKeysAsc.length > 0 ? dateKeysAsc[dateKeysAsc.length - 1] : "n/a";

    const supplierSummaries: SupplierSummary[] = Array.from(supplierDaily.entries()).map(([supplier, dailyMap]) => {
      const dailyMetrics: Record<string, DailyMetric> = {};
      const anomalyDates: Record<string, boolean> = {};
      const performanceAnomalyDates: Record<string, Record<TrendMetricKey, boolean>> = {};
      let anomalyDayCount = 0;
      const dodDeltaByDate: Record<string, number> = {};

      for (let idx = 0; idx < dateKeysAsc.length; idx += 1) {
        const date = dateKeysAsc[idx];
        const todayMetric = dailyMap.get(date) ?? emptyDailyMetric();
        dailyMetrics[date] = todayMetric;
        if (idx === 0) {
          dodDeltaByDate[date] = 0;
          anomalyDates[date] = false;
          performanceAnomalyDates[date] = { cpc: false, cpm: false, ctr: false };
          continue;
        }
        const prevDate = dateKeysAsc[idx - 1];
        const prevMetric = dailyMap.get(prevDate) ?? emptyDailyMetric();
        const dodDeltaRequests = todayMetric.requests - prevMetric.requests;
        const requestAnomaly = Math.abs(dodDeltaRequests) >= dodThresholdMillion * 10000;
        const performanceAnomaly = {
          cpc: isPerformanceDodAnomaly(
            trendMetricValue(todayMetric, "cpc"),
            trendMetricValue(prevMetric, "cpc"),
            performanceDodThresholdPercent,
          ),
          cpm: isPerformanceDodAnomaly(
            trendMetricValue(todayMetric, "cpm"),
            trendMetricValue(prevMetric, "cpm"),
            performanceDodThresholdPercent,
          ),
          ctr: isPerformanceDodAnomaly(
            trendMetricValue(todayMetric, "ctr"),
            trendMetricValue(prevMetric, "ctr"),
            performanceDodThresholdPercent,
          ),
        };
        const anomaly = requestAnomaly || performanceAnomaly.cpc || performanceAnomaly.cpm || performanceAnomaly.ctr;
        dodDeltaByDate[date] = dodDeltaRequests;
        anomalyDates[date] = requestAnomaly;
        performanceAnomalyDates[date] = performanceAnomaly;
        if (anomaly) {
          anomalyDayCount += 1;
        }
      }

      const siteMap = supplierSiteDaily.get(supplier) ?? new Map<string, Map<string, DailyMetric>>();
      const latestSupplierRequests = dailyMetrics[latestDate]?.requests ?? 0;

      const siteDrilldown = Array.from(siteMap.entries())
        .map(([siteKey, siteDailyMap]): SiteDrilldownItem => {
          const latestMetric = siteDailyMap.get(latestDate) ?? emptyDailyMetric();
          const prevDate = dateKeysAsc.length > 1 ? dateKeysAsc[dateKeysAsc.length - 2] : latestDate;
          const prevMetric = siteDailyMap.get(prevDate) ?? emptyDailyMetric();
          const dodDeltaRequests = latestMetric.requests - prevMetric.requests;
          const isAnomalySite = Math.abs(dodDeltaRequests) >= dodThresholdMillion * 10000;
          const status: "normal" | "high" | "medium" = !isAnomalySite
            ? "normal"
            : dodDeltaRequests <= -(dodThresholdMillion * 10000)
              ? "high"
              : "medium";
          const contribution = latestSupplierRequests > 0 ? (latestMetric.requests / latestSupplierRequests) * 100 : 0;
          return {
            siteKey,
            latestRequests: latestMetric.requests,
            dodDeltaRequests,
            contribution,
            status,
            reason: buildReason(status, dodDeltaRequests, latestMetric.requests, dodThresholdMillion),
          };
        })
        .sort((a, b) => {
          if (b.latestRequests !== a.latestRequests) {
            return b.latestRequests - a.latestRequests;
          }
          return Math.abs(b.dodDeltaRequests) - Math.abs(a.dodDeltaRequests);
        });

      const anomalySiteCount = siteDrilldown.filter((item) => item.status !== "normal").length;
      const latestDodDeltaRequests = dodDeltaByDate[latestDate] ?? 0;
      const latestPerformanceAnomaly = performanceAnomalyDates[latestDate] ?? { cpc: false, cpm: false, ctr: false };
      const latestDateAnomaly = isLatestDateAnomaly(anomalyDates, latestDate)
        || latestPerformanceAnomaly.cpc
        || latestPerformanceAnomaly.cpm
        || latestPerformanceAnomaly.ctr;

      return {
        supplier,
        anomalyDayCount,
        anomalySiteCount,
        latestDateAnomaly,
        latestDodDeltaRequests,
        latestRequests: latestSupplierRequests,
        dailyMetrics,
        anomalyDates,
        performanceAnomalyDates,
        siteDrilldown,
      };
    });

    supplierSummaries.sort((a, b) => {
      if (b.latestRequests !== a.latestRequests) {
        return b.latestRequests - a.latestRequests;
      }
      return b.anomalyDayCount - a.anomalyDayCount;
    });

    return {
      dateKeysAsc,
      dateKeysDesc,
      latestDate,
      supplierSummaries,
    };
  }, [dodThresholdMillion, effectiveRows, performanceDodThresholdPercent]);

  const filteredSuppliers = useMemo(() => {
    return filterSupplierSummaries(visibilityMode, anomalyWorkbench.supplierSummaries);
  }, [anomalyWorkbench.supplierSummaries, visibilityMode]);

  const dailyTotals = useMemo(() => {
    const totals = new Map<string, DailyMetric>();
    for (const date of anomalyWorkbench.dateKeysDesc) {
      totals.set(date, emptyDailyMetric());
    }
    for (const supplier of filteredSuppliers) {
      for (const date of anomalyWorkbench.dateKeysDesc) {
        const current = totals.get(date) || emptyDailyMetric();
        const daily = supplier.dailyMetrics[date] ?? emptyDailyMetric();
        current.requests += daily.requests;
        current.impressions += daily.impressions;
        current.clicks += daily.clicks;
        current.revenue += daily.revenue;
        current.dspAmount += daily.dspAmount;
        totals.set(date, current);
      }
    }
    return totals;
  }, [anomalyWorkbench.dateKeysDesc, filteredSuppliers]);

  const anomalySuppliers = useMemo(
    () => filteredSuppliers.filter(isSupplierLevelAnomaly),
    [filteredSuppliers],
  );

  useEffect(() => {
    if (expandedSupplier && !anomalySuppliers.some((item) => item.supplier === expandedSupplier)) {
      setExpandedSupplier(null);
    }
  }, [anomalySuppliers, expandedSupplier]);

  return (
    <Panel title={`${workflow.toUpperCase()} 成效異常 Workspace`} subtitle="控制列 + 每日總表 + 異常供應商收合區，網站異常清單以下鑽呈現。" full>
      <DataStateBlock loading={busy} empty={!busy && effectiveRows.length === 0} />

      {!busy ? (
        <div className="ssp-anomaly-workbench" data-testid="ssp-anomaly-workbench">
          <Panel title="控制列" subtitle="只保留全部顯示 / 異常顯示與 DoD 閾值。">
            <div className="ssp-anomaly-controls">
              <Field label="墊檔資料">
                <div className="ssp-padding-segment" data-testid="ssp-padding-scope-switch">
                  <button
                    type="button"
                    className={selectedPaddingScope === "including_padding" ? "active" : ""}
                    onClick={() => setSelectedPaddingScope("including_padding")}
                  >
                    含墊檔
                  </button>
                  <button
                    type="button"
                    className={selectedPaddingScope === "excluding_padding" ? "active" : ""}
                    onClick={() => setSelectedPaddingScope("excluding_padding")}
                    disabled={excludingPaddingRows.length === 0}
                  >
                    成效不含墊檔
                  </button>
                </div>
              </Field>
              <Field label="顯示模式">
                <select
                  data-testid="ssp-anomaly-visibility-mode"
                  value={visibilityMode}
                  onChange={(event) => setVisibilityMode(event.target.value as VisibilityMode)}
                >
                  <option value="all">全部顯示</option>
                  <option value="anomaly">異常顯示</option>
                </select>
              </Field>
              <Field label="DoD 異常閾值（萬）">
                <input
                  data-testid="ssp-anomaly-dod-threshold"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={dodThresholdInput}
                  onBeforeInput={(event) => {
                    const inputEvent = event.nativeEvent as InputEvent;
                    if (inputEvent.data && !isAsciiDigitInput(inputEvent.data)) {
                      event.preventDefault();
                    }
                  }}
                  onPaste={(event) => {
                    if (!isAsciiDigitInput(event.clipboardData.getData("text"))) {
                      event.preventDefault();
                    }
                  }}
                  onChange={(event) => {
                    const digits = normalizeAsciiDigitInput(event.target.value);
                    setDodThresholdInput(digits);
                  }}
                  onFocus={() => {
                    if (dodThresholdInput === "0") {
                      setDodThresholdInput("");
                    }
                  }}
                  onBlur={() => {
                    if (dodThresholdInput === "") {
                      setDodThresholdInput("0");
                    }
                  }}
                />
              </Field>
              <Field label="成效 DoD 閾值（%）">
                <input
                  data-testid="ssp-anomaly-performance-dod-threshold"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={performanceDodThresholdInput}
                  onBeforeInput={(event) => {
                    const inputEvent = event.nativeEvent as InputEvent;
                    if (inputEvent.data && !isAsciiDigitInput(inputEvent.data)) {
                      event.preventDefault();
                    }
                  }}
                  onPaste={(event) => {
                    if (!isAsciiDigitInput(event.clipboardData.getData("text"))) {
                      event.preventDefault();
                    }
                  }}
                  onChange={(event) => {
                    const digits = normalizeAsciiDigitInput(event.target.value);
                    setPerformanceDodThresholdInput(digits);
                  }}
                  onFocus={() => {
                    if (performanceDodThresholdInput === "0") {
                      setPerformanceDodThresholdInput("");
                    }
                  }}
                  onBlur={() => {
                    if (performanceDodThresholdInput === "") {
                      setPerformanceDodThresholdInput("0");
                    }
                  }}
                />
              </Field>
            </div>
          </Panel>

          <Panel title="近 15 天趨勢圖" subtitle="柱狀圖可切請求 / 曝光；CPC / CPM / CTR 以折線切換，同一張圖交叉檢查。">
            <div className="ssp-anomaly-trend-controls">
              <div className="ssp-anomaly-trend-control-group">
                <span>柱狀</span>
                <div className="ssp-anomaly-trend-toolbar" data-testid="ssp-anomaly-trend-bar-switch">
                  {TREND_BAR_METRICS.map((metric) => (
                    <button
                      key={metric.key}
                      type="button"
                      className={trendBarMetric === metric.key ? "active" : ""}
                      onClick={() => setTrendBarMetric(metric.key)}
                    >
                      {metric.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ssp-anomaly-trend-control-group">
                <span>折線</span>
                <div className="ssp-anomaly-trend-toolbar" data-testid="ssp-anomaly-trend-metric-switch">
                  {TREND_METRICS.map((metric) => (
                    <button
                      key={metric.key}
                      type="button"
                      className={trendMetric === metric.key ? "active" : ""}
                      onClick={() => setTrendMetric(metric.key)}
                    >
                      {metric.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <SspAnomalyTrendChart
              rows={effectiveRows}
              datesAsc={anomalyWorkbench.dateKeysAsc.slice(-15)}
              barMetric={trendBarMetric}
              metric={trendMetric}
            />
          </Panel>

          <Panel title="每日總表" subtitle="主視圖：供應商按最新請求數排序，日期由新到舊。">
            <div className="ssp-anomaly-daily-toolbar">
              <span>表格欄位</span>
              <div className="ssp-anomaly-table-switch" data-testid="ssp-anomaly-daily-table-mode-switch">
                {DAILY_TABLE_MODES.map((mode) => (
                  <button
                    key={mode.key}
                    type="button"
                    className={dailyTableMode === mode.key ? "active" : ""}
                    onClick={() => setDailyTableMode(mode.key)}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="ssp-anomaly-daily-meta">
              <span>顯示 15 列視窗</span>
              <span>欄位: {dailyTableMode === "performance" ? "CPC / CPM / CTR" : "請求 / 曝光 / FR"}</span>
              <span>請求異常: {formatNumber(dodThresholdMillion)} 萬</span>
              <span>成效異常: {formatNumber(performanceDodThresholdPercent)}%</span>
              <span>{selectedPaddingScope === "excluding_padding" ? "請求含墊檔 / 成效不含墊檔" : "含墊檔"}: {formatNumber(selectedRowCount)} rows</span>
              <span>供應商數: {formatNumber(anomalyWorkbench.supplierSummaries.length)}</span>
              <span>異常供應商: {formatNumber(anomalySuppliers.length)}</span>
              <span>可上下 / 左右捲動查看更多資料</span>
            </div>
            <div className="table-wrap ssp-anomaly-daily-table" data-testid="ssp-anomaly-daily-summary">
              <table>
                <thead>
                  <tr>
                    <th rowSpan={2}>供應商</th>
                    {anomalyWorkbench.dateKeysDesc.map((date) => (
                      <th key={`date-${date}`} colSpan={3}>
                        {date}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {anomalyWorkbench.dateKeysDesc.map((date) => (
                      <Fragment key={`header-${date}`}>
                        {dailyHeaders.map((header) => (
                          <th key={`${date}-${header}`}>{header}</th>
                        ))}
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppliers.map((supplier) => {
                    const isLatestAnomaly = isSupplierLevelAnomaly(supplier);
                    return (
                      <tr key={supplier.supplier} className={isLatestAnomaly ? "ssp-anomaly-summary-row-risk" : ""}>
                        <td className={`ssp-anomaly-supplier-cell${isLatestAnomaly ? " ssp-anomaly-supplier-cell-risk" : ""}`}>
                          {supplier.supplier}
                        </td>
                        {anomalyWorkbench.dateKeysDesc.map((date) => {
                          const daily = supplier.dailyMetrics[date] ?? emptyDailyMetric();
                          const isRequestDateAnomaly = Boolean(supplier.anomalyDates[date]);
                          const performanceAnomalies = supplier.performanceAnomalyDates[date] ?? { cpc: false, cpm: false, ctr: false };
                          const values = dailyTableValues(daily, dailyTableMode);
                          return (
                            <Fragment key={`daily-${supplier.supplier}-${date}`}>
                              {values.map((value, index) => (
                                <td
                                  key={`${supplier.supplier}-${date}-${dailyHeaders[index]}`}
                                  className={(dailyTableMode === "traffic" && isRequestDateAnomaly)
                                    || (dailyTableMode === "performance" && performanceAnomalies[PERFORMANCE_METRIC_KEYS[index]])
                                    ? `ssp-anomaly-date-risk${dailyTableMode === "traffic" && index === 0 ? " ssp-anomaly-date-request-risk" : ""}`
                                    : ""}
                                >
                                  {value}
                                </td>
                              ))}
                            </Fragment>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="table-total-row">
                    <td>總計</td>
                    {anomalyWorkbench.dateKeysDesc.map((date) => {
                      const total = dailyTotals.get(date) ?? emptyDailyMetric();
                      const values = dailyTableValues(total, dailyTableMode);
                      return (
                        <Fragment key={`total-${date}`}>
                          {values.map((value, index) => (
                            <td key={`total-${date}-${dailyHeaders[index]}`}>{value}</td>
                          ))}
                        </Fragment>
                      );
                    })}
                  </tr>
                </tfoot>
              </table>
            </div>
          </Panel>

          <Panel title="異常供應商收合區" subtitle="點選供應商展開，下鑽該供應商網站異常清單。">
            {anomalySuppliers.length > 0 ? (
              <div className="ssp-anomaly-expand-list" data-testid="ssp-anomaly-suppliers-accordion">
                <div className="ssp-anomaly-expand-head" data-testid="ssp-anomaly-suppliers-head">
                  <span>供應商</span>
                  <span>DoD 變動(萬)</span>
                  <span>網站異常數</span>
                </div>
                {anomalySuppliers.map((supplier) => {
                  const isOpen = expandedSupplier === supplier.supplier;
                  const anomalySites = supplier.siteDrilldown.filter((site) => site.status !== "normal");
                  return (
                    <details
                      key={supplier.supplier}
                      className="ssp-anomaly-expand-item"
                      open={isOpen}
                      onToggle={(event) => {
                        const target = event.currentTarget;
                        if (target.open) {
                          setExpandedSupplier(supplier.supplier);
                        } else if (expandedSupplier === supplier.supplier) {
                          setExpandedSupplier(null);
                        }
                      }}
                    >
                      <summary>
                        <span className="ssp-anomaly-expand-title">{supplier.supplier}</span>
                        <span className="ssp-anomaly-expand-value">
                          {formatNumber(toMillionUnits(supplier.latestDodDeltaRequests))}
                        </span>
                        <span className="ssp-anomaly-expand-value">{formatNumber(supplier.anomalySiteCount)}</span>
                      </summary>
                      <div className="table-wrap table-wrap-compact ssp-anomaly-site-table" data-testid="ssp-anomaly-site-drilldown">
                        {anomalySites.length > 0 ? (
                          <table>
                            <thead>
                              <tr>
                                <th>網站名稱</th>
                                <th>最新請求量</th>
                                <th>DoD 變動(萬)</th>
                                <th>貢獻比</th>
                                <th>狀態</th>
                                <th>異常原因</th>
                              </tr>
                            </thead>
                            <tbody>
                              {anomalySites.map((site) => (
                                <tr key={`${supplier.supplier}-${site.siteKey}`}>
                                  <td>{site.siteKey}</td>
                                  <td>{formatNumber(site.latestRequests)}</td>
                                  <td>{formatNumber(toMillionUnits(site.dodDeltaRequests))}</td>
                                  <td>{formatPercent(site.contribution)}</td>
                                  <td>
                                    {site.status === "normal" ? (
                                      <span className="ssp-risk-badge">正常</span>
                                    ) : (
                                      <span className={`ssp-risk-badge ssp-risk-${site.status}`}>
                                        {site.status === "high" ? "高風險" : "中風險"}
                                      </span>
                                    )}
                                  </td>
                                  <td>{site.reason}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="workspace-note">目前沒有網站異常。</div>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
            ) : (
              <div className="workspace-note">目前沒有異常供應商</div>
            )}
          </Panel>
        </div>
      ) : null}
    </Panel>
  );
}
