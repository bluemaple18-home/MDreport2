import { Fragment, useMemo, useState } from "react";
import type { SspAdGroupMetricSummary, SspAdGroupMonitorSnapshot } from "../../types";
import { formatAmount, formatNumber, formatPercent } from "../../utils/format";
import { ActionButton, DataStateBlock, Panel } from "../ui";
import { placementRowKey, rowKey } from "./sspAdGroupMonitorRules";

type Props = {
  snapshot?: SspAdGroupMonitorSnapshot;
  busy: boolean;
  periodWeekStart: string;
  periodWeekEnd: string;
  onRefresh: (zoneGroupId: number, date: string) => Promise<boolean>;
};

type MetricKey = "request" | "impress" | "click" | "ctr" | "ecpm" | "ecpc" | "advertiser_mu";

const METRICS: Array<{ key: MetricKey; label: string; format: (value: unknown) => string }> = [
  { key: "request", label: "請求", format: formatNumber },
  { key: "impress", label: "曝光", format: formatNumber },
  { key: "click", label: "點擊", format: formatNumber },
  { key: "ctr", label: "點擊率", format: formatPercent },
  { key: "ecpm", label: "CPM", format: formatAmount },
  { key: "ecpc", label: "CPC", format: formatAmount },
  { key: "advertiser_mu", label: "執行金額", format: formatAmount },
];

const AVG_COLUMN_KEY = "__recent_7_avg__";
const CHART_COLORS = ["#2563eb", "#dc2626", "#16a34a", "#9333ea", "#f97316", "#0891b2", "#64748b", "#be185d"];

const TIER_ORDER: Record<string, number> = { 高: 0, 中: 1, 低: 2 };
const QUALITY_METRICS = new Set<MetricKey>(["ctr", "ecpm", "ecpc"]);
const LOWER_IS_BETTER = new Set<MetricKey>(["ecpm", "ecpc"]);

function metricValue(row: SspAdGroupMetricSummary, key: MetricKey): number {
  const value = row[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function metricValueFromRecord(row: Record<string, unknown> | undefined, key: MetricKey): number {
  const value = row?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function metricDirection(row: SspAdGroupMetricSummary, date: string, key: MetricKey): "good" | "bad" | "neutral" {
  if (!QUALITY_METRICS.has(key)) {
    return "neutral";
  }
  const baseline = metricValueFromRecord(row.avg_metrics, key);
  const daily = metricValue(row.daily_metrics?.[date] || row, key);
  if (baseline <= 0) {
    return "neutral";
  }
  const delta = (daily - baseline) / baseline;
  if (Math.abs(delta) <= 0.05) {
    return "neutral";
  }
  const isLowerBetter = LOWER_IS_BETTER.has(key);
  if (isLowerBetter) {
    return delta < 0 ? "good" : "bad";
  }
  return delta > 0 ? "good" : "bad";
}

function isMetricAnomaly(row: SspAdGroupMetricSummary, date: string, key: MetricKey): boolean {
  return metricDirection(row, date, key) === "bad";
}

function metricVsRecentAverage(row: SspAdGroupMetricSummary, date: string, key: MetricKey): number {
  const baseline = metricValueFromRecord(row.avg_metrics, key);
  const daily = metricValue(row.daily_metrics?.[date] || row, key);
  if (baseline <= 0) {
    return 0;
  }
  return ((daily - baseline) / baseline) * 100;
}

function formatDod(value: number): string {
  if (!Number.isFinite(value)) {
    return "0%";
  }
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function rowLabel(row: SspAdGroupMetricSummary): string {
  if (row.price_tier && row.price_tier !== "全部") {
    return `${row.price_tier}`;
  }
  return String(row.ad_format || row.zone_group_name || row.zone_name || "");
}

function median(values: number[]): number {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) {
    return 0;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function buildPath(values: number[], minValue: number, maxValue: number, width: number, height: number, left: number, top: number): string {
  const range = Math.max(0.000001, maxValue - minValue);
  return values.map((value, index) => {
    const plottedValue = Math.min(Math.max(value, minValue), maxValue);
    const x = left + (values.length <= 1 ? 0 : (index / (values.length - 1)) * width);
    const y = top + height - ((plottedValue - minValue) / range) * height;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function metricPointStatus(value: number, average: number, metric: MetricKey): "bad" | "good" | "neutral" {
  if (!QUALITY_METRICS.has(metric) || average <= 0) {
    return "neutral";
  }
  const delta = (value - average) / average;
  if (Math.abs(delta) <= 0.05) {
    return "neutral";
  }
  if (LOWER_IS_BETTER.has(metric)) {
    return delta > 0 ? "bad" : "good";
  }
  return delta < 0 ? "bad" : "good";
}

function MetricTrendChart({
  title,
  metric,
  rows,
  datesAsc,
  compact = false,
}: {
  title: string;
  metric: MetricKey;
  rows: SspAdGroupMetricSummary[];
  datesAsc: string[];
  compact?: boolean;
}) {
  const [hoveredKey, setHoveredKey] = useState<string>("");
  const [lockedKey, setLockedKey] = useState<string>("");
  const [selectedPoint, setSelectedPoint] = useState<{
    key: string;
    label: string;
    date: string;
    value: number;
    average: number;
    dod: number;
    status: "bad" | "good" | "neutral";
    color: string;
  } | null>(null);
  const metricConfig = METRICS.find((item) => item.key === metric) || METRICS[0];
  const latestDate = datesAsc[datesAsc.length - 1] || "";
  const latestValues = rows.map((row) => metricValue(row.daily_metrics?.[latestDate] || row, metric));
  const latestMedian = median(latestValues);
  const series = rows.map((row, index) => {
    const values = datesAsc.map((date) => metricValue(row.daily_metrics?.[date] || row, metric));
    const latestValue = values[values.length - 1] || 0;
    const peakValue = Math.max(...values, latestValue, 0);
    const label = rowLabel(row);
    const isScaleOutlier = (latestMedian > 0 && peakValue > latestMedian * 2) || label === "展示型";
    return {
    key: rowKey(row) || `${index}`,
    label,
    color: CHART_COLORS[index % CHART_COLORS.length],
    average: metricValueFromRecord(row.avg_metrics, metric),
    latestValue,
    isOutlier: isScaleOutlier || (latestMedian > 0 && Math.abs((latestValue - latestMedian) / latestMedian) >= 0.5),
    values,
  };
  });
  const scaleSource = series.filter((item) => !item.isOutlier);
  const scaleRows = scaleSource.length ? scaleSource : series;
  const allValues = scaleRows.flatMap((item) => [...item.values, item.average]).filter((value) => Number.isFinite(value));
  const finiteValues = allValues.length ? allValues : [0, 1];
  const minRaw = Math.min(...finiteValues);
  const maxRaw = Math.max(...finiteValues, minRaw + 1);
  const padding = Math.max((maxRaw - minRaw) * 0.12, Math.abs(maxRaw) * 0.03, 0.000001);
  const minValue = Math.max(0, minRaw - padding);
  const maxValue = maxRaw + padding;
  const averageValue = scaleRows.length
    ? scaleRows.reduce((sum, item) => sum + item.average, 0) / scaleRows.length
    : 0;
  const width = 760;
  const height = compact ? 104 : 170;
  const left = 30;
  const top = 8;
  const plotWidth = width - left - 8;
  const plotHeight = height - top - 18;
  const avgY = top + plotHeight - ((averageValue - minValue) / Math.max(0.000001, maxValue - minValue)) * plotHeight;
  const avgTopPercent = ((maxValue - averageValue) / Math.max(0.000001, maxValue - minValue)) * 100;
  const activeKey = hoveredKey || lockedKey;
  const focusedSeries = series.find((item) => item.key === activeKey);
  const yTicks = Array.from({ length: 5 }, (_, index) => {
    const value = maxValue - ((maxValue - minValue) / 4) * index;
    const topPercent = ((maxValue - value) / Math.max(0.000001, maxValue - minValue)) * 100;
    return { value, topPercent };
  }).filter((tick) => Number.isFinite(tick.value) && Number.isFinite(tick.topPercent));

  return (
    <div className={`ad-group-chart-card${compact ? " ad-group-chart-card-compact" : ""}`}>
      <div className="ad-group-chart-head">
        <span>{title}</span>
        <span>X 軸：日期　Y 軸：{metricConfig.label}</span>
      </div>
      <div className="ad-group-chart-meta">
        <span>線條：廣告形式</span>
        <span>灰色虛線：近 7 天平均 {metricConfig.format(averageValue)}</span>
        <span>離群線不參與 Y 軸尺度</span>
        {focusedSeries ? (
          <span className="ad-group-chart-focus">
            {focusedSeries.label}｜{latestDate}：{metricConfig.format(focusedSeries.latestValue)}｜均值：{metricConfig.format(focusedSeries.average)}
          </span>
        ) : null}
      </div>
      {selectedPoint ? (
        <div className="ad-group-chart-selection" style={{ borderColor: selectedPoint.color }}>
          <span>{selectedPoint.label}</span>
          <span>{selectedPoint.date}</span>
          <span>{metricConfig.label}：{metricConfig.format(selectedPoint.value)}</span>
          <span>近 7 天平均：{metricConfig.format(selectedPoint.average)}</span>
          <span>vs 近 7 天：{formatDod(selectedPoint.dod)}</span>
          <span>{selectedPoint.status === "bad" ? "異常" : selectedPoint.status === "good" ? "表現良好" : "正常"}</span>
        </div>
      ) : null}
      <div className="ad-group-chart-plot">
        <div className="ad-group-chart-y-axis">
          <span
            className="ad-group-chart-y-average"
            style={{ top: `${Math.min(Math.max(avgTopPercent, 0), 100)}%` }}
          >
            均 {metricConfig.format(averageValue)}
          </span>
          {yTicks.map((tick, index) => (
            <span key={`y-label-${index}`} style={{ top: `${tick.topPercent}%` }}>
              {metricConfig.format(tick.value)}
            </span>
          ))}
        </div>
        <svg
          className="ad-group-chart-svg"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${title} ${metricConfig.label} 趨勢`}
        >
          <line x1={left} x2={width - 8} y1={top + plotHeight} y2={top + plotHeight} className="ad-group-chart-axis" />
          <line x1={left} x2={left} y1={top} y2={top + plotHeight} className="ad-group-chart-axis" />
          <line x1={left} x2={width - 8} y1={avgY} y2={avgY} className="ad-group-chart-average" />
          {yTicks.map((tick, index) => {
            const y = top + (tick.topPercent / 100) * plotHeight;
            return <line key={`y-grid-${index}`} x1={left} x2={width - 8} y1={y} y2={y} className="ad-group-chart-grid-horizontal" />;
          })}
          {datesAsc.map((_, index) => {
            const x = left + (datesAsc.length <= 1 ? 0 : (index / (datesAsc.length - 1)) * plotWidth);
            return <line key={index} x1={x} x2={x} y1={top} y2={top + plotHeight} className="ad-group-chart-grid" />;
          })}
          {series.map((item) => {
            const isFocused = !activeKey || activeKey === item.key;
            return (
              <path
                key={item.key}
                d={buildPath(item.values, minValue, maxValue, plotWidth, plotHeight, left, top)}
                fill="none"
              stroke={item.color}
              strokeWidth={activeKey === item.key ? 3.2 : compact ? 1.8 : 2.2}
              strokeDasharray={item.isOutlier ? "7 5" : undefined}
              opacity={isFocused ? 1 : 0.12}
                onMouseEnter={() => setHoveredKey(item.key)}
                onMouseLeave={() => setHoveredKey("")}
              />
            );
          })}
          {series.map((item) => item.values.map((value, index) => {
            const x = left + (datesAsc.length <= 1 ? 0 : (index / (datesAsc.length - 1)) * plotWidth);
            const plottedValue = Math.min(Math.max(value, minValue), maxValue);
            const y = top + plotHeight - ((plottedValue - minValue) / Math.max(0.000001, maxValue - minValue)) * plotHeight;
            const isFocused = !activeKey || activeKey === item.key;
            const status = metricPointStatus(value, item.average, metric);
            const nodeClass = `ad-group-chart-node${status === "bad" ? " ad-group-chart-node-alert" : ""}`;
            return (
              <g
                key={`${item.key}-${datesAsc[index]}`}
                opacity={isFocused ? 1 : 0.18}
                onMouseEnter={() => setHoveredKey(item.key)}
                onMouseLeave={() => setHoveredKey("")}
                onClick={() => {
                  const average = item.average;
                  const dod = average > 0 ? ((value - average) / average) * 100 : 0;
                  setLockedKey(item.key);
                  setSelectedPoint({
                    key: item.key,
                    label: item.label,
                    date: datesAsc[index],
                    value,
                    average,
                    dod,
                    status,
                    color: item.color,
                  });
                }}
              >
                <circle
                  cx={x}
                  cy={y}
                  r={status === "bad" ? 4.8 : activeKey === item.key ? 4.2 : 3.2}
                  fill={status === "bad" ? "#ffffff" : item.color}
                  stroke={item.color}
                  className={nodeClass}
                >
                  <title>{`${item.label} ${datesAsc[index]} ${metricConfig.label}: ${metricConfig.format(value)} ${status === "bad" ? "異常" : status === "good" ? "表現良好" : "正常"}`}</title>
                </circle>
              </g>
            );
          }))}
        </svg>
      </div>
      <div className="ad-group-chart-x-axis" style={{ gridTemplateColumns: `repeat(${datesAsc.length || 1}, minmax(0, 1fr))` }}>
        {datesAsc.map((date) => <span key={date}>{date.slice(5)}</span>)}
      </div>
      <div className="ad-group-chart-legend">
        {series.map((item) => (
          <button
            key={item.key}
            type="button"
            className={activeKey === item.key ? "is-focused" : ""}
            onMouseEnter={() => setHoveredKey(item.key)}
            onMouseLeave={() => setHoveredKey("")}
            onClick={() => setLockedKey((current) => current === item.key ? "" : item.key)}
          >
            <i style={{ background: item.color }} />{item.label}{item.isOutlier ? <b>離群</b> : null}
          </button>
        ))}
        {lockedKey ? (
          <button type="button" onClick={() => setLockedKey("")}>顯示全部</button>
        ) : null}
        <span><i className="avg-legend" />近 7 天平均</span>
      </div>
    </div>
  );
}

export function SspAdGroupMonitorWorkspace({ snapshot, busy, periodWeekStart, periodWeekEnd, onRefresh }: Props) {
  const [activeFormat, setActiveFormat] = useState<string>("總表");
  const [selectedMetrics, setSelectedMetrics] = useState<MetricKey[]>(["ecpc"]);
  const [chartMetric, setChartMetric] = useState<MetricKey>("ecpc");
  const [targetDate, setTargetDate] = useState<string>(periodWeekEnd);
  const [expandedFormats, setExpandedFormats] = useState<Set<string>>(new Set());
  const groups = snapshot?.groups || [];
  const formatSummary = snapshot?.format_summary || [];
  const formats = snapshot?.formats || [];
  const dateKeysDesc = snapshot?.date_keys_desc || [];
  const visibleGroups = useMemo(() => {
    if (activeFormat === "總表") {
      return groups;
    }
    return groups.filter((row) => row.ad_format === activeFormat);
  }, [activeFormat, groups]);
  const [expandedGroupId, setExpandedGroupId] = useState<string>("");
  const effectiveExpandedGroupId = expandedGroupId;
  const placementRows = effectiveExpandedGroupId
    ? snapshot?.placements_by_group?.[effectiveExpandedGroupId] || []
    : [];
  const expandedGroup = groups.find((row) => String(row.zone_group_id || "") === effectiveExpandedGroupId);
  const selectedGroupId = Number(effectiveExpandedGroupId || 0);

  const toggleMetric = (key: MetricKey) => {
    setChartMetric(key);
    setSelectedMetrics((prev) => {
      if (prev.includes(key)) {
        if (prev.length === 1) {
          return prev;
        }
        const next = prev.filter((item) => item !== key);
        setChartMetric(next[0]);
        return next;
      }
      return [...prev, key];
    });
  };

  const metricHeaders = METRICS.filter((metric) => selectedMetrics.includes(metric.key));
  const chartMetricConfig = METRICS.find((metric) => metric.key === chartMetric) || METRICS.find((metric) => metric.key === "ecpc") || METRICS[0];
  const sortedFormatSummary = [...formatSummary].sort((a, b) => {
    const requestCompare = metricValue(b, "request") - metricValue(a, "request");
    if (requestCompare !== 0) return requestCompare;
    return String(a.ad_format || "").localeCompare(String(b.ad_format || ""), "zh-Hant");
  });
  const sortedVisibleGroups = [...visibleGroups].sort((a, b) => {
    const formatCompare = String(a.ad_format || "").localeCompare(String(b.ad_format || ""), "zh-Hant");
    if (formatCompare !== 0) return formatCompare;
    return (TIER_ORDER[String(a.price_tier || "")] ?? 9) - (TIER_ORDER[String(b.price_tier || "")] ?? 9);
  });
  const toggleFormatExpansion = (format: string) => {
    setExpandedFormats((prev) => {
      const next = new Set(prev);
      if (next.has(format)) {
        next.delete(format);
      } else {
        next.add(format);
      }
      return next;
    });
  };
  const chartRows = sortedFormatSummary;
  const datesAsc = [...dateKeysDesc].reverse();
  const renderMetricCells = (row: SspAdGroupMetricSummary, key: string) => (
    <>
      {metricHeaders.map((metric) => (
        <td key={`${key}-${AVG_COLUMN_KEY}-${metric.key}`} className="avg-cell">
          {metric.format(metricValueFromRecord(row.avg_metrics, metric.key))}
        </td>
      ))}
      {metricHeaders.map((metric) => {
        const latestDate = dateKeysDesc[0] || "";
        const dod = latestDate ? metricVsRecentAverage(row, latestDate, metric.key) : 0;
        const direction = latestDate ? metricDirection(row, latestDate, metric.key) : "neutral";
        return (
          <td
            key={`${key}-dod-${metric.key}`}
            className={`dod-cell${direction === "bad" ? " ad-group-date-risk" : ""}${direction === "good" ? " ad-group-date-good" : ""}`}
          >
            {formatDod(dod)}
          </td>
        );
      })}
      {dateKeysDesc.map((date) => {
        const daily = row.daily_metrics?.[date];
        const isLatestDate = date === dateKeysDesc[0];
        return (
          <Fragment key={`${key}-${date}`}>
            {metricHeaders.map((metric) => {
              const direction = metricDirection(row, date, metric.key);
              return (
                <td
                  key={`${key}-${date}-${metric.key}`}
                  className={
                    direction === "bad"
                      ? (isLatestDate ? "ad-group-date-risk" : "ad-group-date-risk-text")
                      : direction === "good"
                        ? (isLatestDate ? "ad-group-date-good" : "ad-group-date-good-text")
                        : ""
                  }
                >
                  {metric.format(metricValue(daily || row, metric.key))}
                </td>
              );
            })}
          </Fragment>
        );
      })}
    </>
  );

  return (
    <div className="ssp-ad-group-workspace">
      <Panel
        title="廣告群組成效"
        subtitle={`${periodWeekStart} ~ ${periodWeekEnd}，預設看 CPC，可多選指標交叉檢查`}
        full
      >
        <div className="toolbar-row">
          <div className="btn-row" role="tablist" aria-label="廣告形式">
            {["總表", ...formats].map((format) => (
              <ActionButton
                key={format}
                label={format}
                variant={activeFormat === format ? "primary" : "ghost"}
                onClick={() => {
                  setActiveFormat(format);
                  setExpandedGroupId("");
                }}
                disabled={busy}
                role="tab"
                ariaSelected={activeFormat === format}
              />
            ))}
          </div>
          <div className="ad-group-refresh-box">
            <label>
              <span>抓取日期</span>
              <input
                type="date"
                value={targetDate}
                onChange={(event) => setTargetDate(event.target.value)}
                disabled={busy}
              />
            </label>
            <ActionButton
              label={busy ? "更新中" : `更新 ${selectedGroupId || ""} 當日`}
              onClick={() => {
                if (selectedGroupId > 0 && targetDate) {
                  void onRefresh(selectedGroupId, targetDate);
                }
              }}
              disabled={busy || selectedGroupId <= 0 || !targetDate}
            />
          </div>
        </div>
        <div className="metric-toggle-row" aria-label="顯示指標">
          {METRICS.map((metric) => (
            <label key={metric.key} className="metric-toggle">
              <input
                type="checkbox"
                checked={selectedMetrics.includes(metric.key)}
                onChange={() => toggleMetric(metric.key)}
              />
              <span>{metric.label}</span>
            </label>
          ))}
        </div>
        <DataStateBlock loading={busy && !snapshot} empty={!busy && groups.length === 0} />
      </Panel>

      <Panel title={activeFormat === "總表" ? "6 組收合總表" : `${activeFormat} 高中低多日成效`} subtitle="日期由新到舊，總表點廣告形式展開 18 組，點任一群組後下方展開版位多日成效。" full>
        {activeFormat === "總表" ? (
          <>
            <div className="ad-group-chart-toolbar">
              <span>目前折線圖：{chartMetricConfig.label}</span>
            </div>
            <MetricTrendChart title={`廣告形式 ${chartMetricConfig.label}`} metric={chartMetricConfig.key} rows={chartRows} datesAsc={datesAsc} />
          </>
        ) : null}
        <div className="table-wrap ssp-ad-group-daily-table">
          <table>
            <thead>
              <tr>
                <th rowSpan={2}>狀態</th>
                <th rowSpan={2}>廣告形式</th>
                <th rowSpan={2}>價位</th>
                <th rowSpan={2}>群組</th>
                <th colSpan={metricHeaders.length}>近 7 天平均</th>
                <th colSpan={metricHeaders.length}>vs 近 7 天</th>
                {dateKeysDesc.map((date) => (
                  <th key={date} colSpan={metricHeaders.length}>{date}</th>
                ))}
              </tr>
              <tr>
                {metricHeaders.map((metric) => <th key={`${AVG_COLUMN_KEY}-${metric.key}`}>{metric.label}</th>)}
                {metricHeaders.map((metric) => <th key={`dod-${metric.key}`}>{metric.label}</th>)}
                {dateKeysDesc.map((date) => (
                  <Fragment key={`header-${date}`}>
                    {metricHeaders.map((metric) => <th key={`${date}-${metric.key}`}>{metric.label}</th>)}
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {activeFormat === "總表" ? sortedFormatSummary.flatMap((formatRow) => {
                const format = String(formatRow.ad_format || "");
                const isOpen = expandedFormats.has(format);
                const childRows = sortedVisibleGroups.filter((row) => row.ad_format === format);
                const rows = [
                  <tr
                    key={`format-${format}`}
                    className={`${formatRow.status === "alert" ? "row-alert" : ""} format-summary-row`}
                    onClick={() => {
                      toggleFormatExpansion(format);
                    }}
                  >
                    <td><span className={`signal-dot signal-${formatRow.status === "alert" ? "alert" : "ok"}`} /></td>
                    <td><span className="expand-mark">{isOpen ? "−" : "+"}</span>{format}</td>
                    <td>全部</td>
                    <td>
                      <span>{format}</span>
                      <span className="muted-cell">收合 {childRows.length} 組</span>
                    </td>
                    {renderMetricCells(formatRow, `format-${format}`)}
                  </tr>,
                ];
                if (isOpen) {
                  rows.push(...childRows.map((row) => {
                    const key = rowKey(row);
                    const isExpanded = effectiveExpandedGroupId === key;
                    return (
                      <tr
                        key={key}
                        className={`${row.status === "alert" ? "row-alert" : ""}${isExpanded ? " row-selected" : ""} child-group-row`}
                        onClick={() => setExpandedGroupId(key)}
                      >
                        <td><span className={`signal-dot signal-${row.status === "alert" ? "alert" : "ok"}`} /></td>
                        <td>{row.ad_format || ""}</td>
                        <td>{row.price_tier || ""}</td>
                        <td>
                          <span>{row.zone_group_id}</span>
                          <span className="muted-cell">{row.zone_group_name}</span>
                        </td>
                        {renderMetricCells(row, key)}
                      </tr>
                    );
                  }));
                }
                return rows;
              }) : sortedVisibleGroups.map((row) => {
                const key = rowKey(row);
                const isExpanded = effectiveExpandedGroupId === key;
                return (
                  <tr
                    key={key}
                    className={`${row.status === "alert" ? "row-alert" : ""}${isExpanded ? " row-selected" : ""}`}
                    onClick={() => setExpandedGroupId(key)}
                  >
                    <td><span className={`signal-dot signal-${row.status === "alert" ? "alert" : "ok"}`} /></td>
                    <td>{row.ad_format || ""}</td>
                    <td>{row.price_tier || ""}</td>
                    <td>
                      <span>{row.zone_group_id}</span>
                      <span className="muted-cell">{row.zone_group_name}</span>
                    </td>
                    {renderMetricCells(row, key)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title={`版位多日拆解${expandedGroup ? `：${expandedGroup.zone_group_id} ${expandedGroup.zone_group_name}` : ""}`}
        subtitle="像成效異常頁一樣橫向看很多天，找出是哪一天、哪個版位把群組數字拉歪。"
        full
      >
        <div className="table-wrap ssp-ad-group-daily-table">
          <table>
            <thead>
              <tr>
                <th rowSpan={2}>狀態</th>
                <th rowSpan={2}>版位</th>
                <th rowSpan={2}>版位名稱</th>
                <th colSpan={metricHeaders.length}>近 7 天平均</th>
                <th colSpan={metricHeaders.length}>vs 近 7 天</th>
                {dateKeysDesc.map((date) => (
                  <th key={date} colSpan={metricHeaders.length}>{date}</th>
                ))}
              </tr>
              <tr>
                {metricHeaders.map((metric) => <th key={`placement-${AVG_COLUMN_KEY}-${metric.key}`}>{metric.label}</th>)}
                {metricHeaders.map((metric) => <th key={`placement-dod-${metric.key}`}>{metric.label}</th>)}
                {dateKeysDesc.map((date) => (
                  <Fragment key={`placement-header-${date}`}>
                    {metricHeaders.map((metric) => <th key={`placement-${date}-${metric.key}`}>{metric.label}</th>)}
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {placementRows.map((row) => {
                const key = placementRowKey(row);
                return (
                  <tr key={key} className={row.status === "alert" ? "row-alert" : ""}>
                    <td><span className={`signal-dot signal-${row.status === "alert" ? "alert" : "ok"}`} /></td>
                    <td>{row.zone_id}</td>
                    <td>
                      <span>{row.zone_name || "-"}</span>
                    </td>
                    {renderMetricCells(row, key)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
