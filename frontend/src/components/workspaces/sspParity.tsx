import { Fragment, useEffect, useMemo, useState } from "react";
import type { Workflow } from "../../types";
import { DataStateBlock, Field, Panel } from "../ui";
import type { RowData } from "./shared";
import { numValue } from "./shared";
import { formatNumber, formatPercent } from "../../utils/format";

type SspParityWorkspaceProps = {
  rows: RowData[];
  workflow: Workflow;
  busy: boolean;
};

type DailyMetric = {
  requests: number;
  impressions: number;
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
  latestDodDeltaRequests: number;
  latestRequests: number;
  dailyMetrics: Record<string, DailyMetric>;
  anomalyDates: Record<string, boolean>;
  siteDrilldown: SiteDrilldownItem[];
};

type VisibilityMode = "all" | "anomaly";

const DOD_THRESHOLD_MILLION = 500;
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

export function SspParityWorkspace({ rows, workflow, busy }: SspParityWorkspaceProps) {
  const [visibilityMode, setVisibilityMode] = useState<VisibilityMode>("all");
  const [dodThresholdMillion, setDodThresholdMillion] = useState<number>(DOD_THRESHOLD_MILLION);
  const [expandedSupplier, setExpandedSupplier] = useState<string | null>(null);

  const anomalyWorkbench = useMemo(() => {
    const supplierDaily = new Map<string, Map<string, DailyMetric>>();
    const supplierSiteDaily = new Map<string, Map<string, Map<string, DailyMetric>>>();
    const allDateKeys = new Set<string>();

    for (const row of rows) {
      const supplier = normalizeSupplier(row);
      const siteKey = normalizeSiteKey(row);
      const dateKey = normalizeDateKey(row);
      const requests = resolveRequestCount(row);
      const impressions = resolveImpressionCount(row);

      allDateKeys.add(dateKey);

      const dailyMap = supplierDaily.get(supplier) ?? new Map<string, DailyMetric>();
      const dailyItem = dailyMap.get(dateKey) ?? { requests: 0, impressions: 0 };
      dailyItem.requests += requests;
      dailyItem.impressions += impressions;
      dailyMap.set(dateKey, dailyItem);
      supplierDaily.set(supplier, dailyMap);

      const siteMap = supplierSiteDaily.get(supplier) ?? new Map<string, Map<string, DailyMetric>>();
      const siteDailyMap = siteMap.get(siteKey) ?? new Map<string, DailyMetric>();
      const siteDailyItem = siteDailyMap.get(dateKey) ?? { requests: 0, impressions: 0 };
      siteDailyItem.requests += requests;
      siteDailyItem.impressions += impressions;
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
      let anomalyDayCount = 0;
      const dodDeltaByDate: Record<string, number> = {};

      for (let idx = 0; idx < dateKeysAsc.length; idx += 1) {
        const date = dateKeysAsc[idx];
        const todayMetric = dailyMap.get(date) ?? { requests: 0, impressions: 0 };
        dailyMetrics[date] = todayMetric;
        if (idx === 0) {
          dodDeltaByDate[date] = 0;
          anomalyDates[date] = false;
          continue;
        }
        const prevDate = dateKeysAsc[idx - 1];
        const prevMetric = dailyMap.get(prevDate) ?? { requests: 0, impressions: 0 };
        const dodDeltaRequests = todayMetric.requests - prevMetric.requests;
        const anomaly = Math.abs(dodDeltaRequests) >= dodThresholdMillion * 10000;
        dodDeltaByDate[date] = dodDeltaRequests;
        anomalyDates[date] = anomaly;
        if (anomaly) {
          anomalyDayCount += 1;
        }
      }

      const siteMap = supplierSiteDaily.get(supplier) ?? new Map<string, Map<string, DailyMetric>>();
      const latestSupplierRequests = dailyMetrics[latestDate]?.requests ?? 0;

      const siteDrilldown = Array.from(siteMap.entries())
        .map(([siteKey, siteDailyMap]): SiteDrilldownItem => {
          const latestMetric = siteDailyMap.get(latestDate) ?? { requests: 0, impressions: 0 };
          const prevDate = dateKeysAsc.length > 1 ? dateKeysAsc[dateKeysAsc.length - 2] : latestDate;
          const prevMetric = siteDailyMap.get(prevDate) ?? { requests: 0, impressions: 0 };
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

      return {
        supplier,
        anomalyDayCount,
        anomalySiteCount,
        latestDodDeltaRequests,
        latestRequests: latestSupplierRequests,
        dailyMetrics,
        anomalyDates,
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
  }, [dodThresholdMillion, rows]);

  const filteredSuppliers = useMemo(() => {
    if (visibilityMode === "all") {
      return anomalyWorkbench.supplierSummaries;
    }
    return anomalyWorkbench.supplierSummaries.filter((item) => item.anomalyDayCount > 0 || item.anomalySiteCount > 0);
  }, [anomalyWorkbench.supplierSummaries, visibilityMode]);

  const dailyTotals = useMemo(() => {
    const totals = new Map<string, { requests: number; impressions: number }>();
    for (const date of anomalyWorkbench.dateKeysDesc) {
      totals.set(date, { requests: 0, impressions: 0 });
    }
    for (const supplier of filteredSuppliers) {
      for (const date of anomalyWorkbench.dateKeysDesc) {
        const current = totals.get(date) || { requests: 0, impressions: 0 };
        const daily = supplier.dailyMetrics[date] ?? { requests: 0, impressions: 0 };
        current.requests += daily.requests;
        current.impressions += daily.impressions;
        totals.set(date, current);
      }
    }
    return totals;
  }, [anomalyWorkbench.dateKeysDesc, filteredSuppliers]);

  const anomalySuppliers = useMemo(
    () => filteredSuppliers.filter((item) => item.anomalyDayCount > 0 || item.anomalySiteCount > 0),
    [filteredSuppliers],
  );

  useEffect(() => {
    if (expandedSupplier && !anomalySuppliers.some((item) => item.supplier === expandedSupplier)) {
      setExpandedSupplier(null);
    }
  }, [anomalySuppliers, expandedSupplier]);

  return (
    <Panel title={`${workflow.toUpperCase()} 成效異常 Workspace`} subtitle="控制列 + 每日總表 + 異常供應商收合區，網站異常清單以下鑽呈現。" full>
      <DataStateBlock loading={busy} empty={!busy && rows.length === 0} />

      {!busy ? (
        <div className="ssp-anomaly-workbench" data-testid="ssp-anomaly-workbench">
          <div className="status-bar">
            <span>日期範圍: {anomalyWorkbench.dateKeysAsc[0] ?? "n/a"} ~ {anomalyWorkbench.latestDate}</span>
            <span>供應商數: {formatNumber(anomalyWorkbench.supplierSummaries.length)}</span>
            <span>異常供應商: {formatNumber(anomalySuppliers.length)}</span>
          </div>

          <Panel title="控制列" subtitle="只保留全部顯示 / 異常顯示與 DoD 閾值。">
            <div className="ssp-anomaly-controls">
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
                  type="number"
                  min="0"
                  value={dodThresholdMillion}
                  onChange={(event) => setDodThresholdMillion(Math.max(0, Number(event.target.value || 0)))}
                />
              </Field>
            </div>
          </Panel>

          <Panel title="每日總表" subtitle="主視圖：供應商按最新請求數排序，日期由新到舊。">
            <div className="ssp-anomaly-daily-meta">
              <span>顯示 15 列視窗</span>
              <span>供應商總數: {formatNumber(filteredSuppliers.length)}</span>
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
                        <th>請求</th>
                        <th>曝光</th>
                        <th>FR(%)</th>
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppliers.map((supplier) => {
                    const isSupplierAnomaly = supplier.anomalyDayCount > 0 || supplier.anomalySiteCount > 0;
                    return (
                      <tr key={supplier.supplier} className={isSupplierAnomaly ? "ssp-anomaly-summary-row-risk" : ""}>
                        <td className={`ssp-anomaly-supplier-cell${isSupplierAnomaly ? " ssp-anomaly-supplier-cell-risk" : ""}`}>
                          {supplier.supplier}
                        </td>
                        {anomalyWorkbench.dateKeysDesc.map((date) => {
                          const daily = supplier.dailyMetrics[date] ?? { requests: 0, impressions: 0 };
                          const fr = daily.requests > 0 ? (daily.impressions / daily.requests) * 100 : 0;
                          const isDateAnomaly = Boolean(supplier.anomalyDates[date]);
                          return (
                            <Fragment key={`daily-${supplier.supplier}-${date}`}>
                              <td className={isDateAnomaly ? "ssp-anomaly-date-risk" : ""}>{formatNumber(daily.requests)}</td>
                              <td className={isDateAnomaly ? "ssp-anomaly-date-risk" : ""}>{formatNumber(daily.impressions)}</td>
                              <td className={isDateAnomaly ? "ssp-anomaly-date-risk" : ""}>{formatPercent(fr)}</td>
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
                      const total = dailyTotals.get(date) ?? { requests: 0, impressions: 0 };
                      const fr = total.requests > 0 ? (total.impressions / total.requests) * 100 : 0;
                      return (
                        <Fragment key={`total-${date}`}>
                          <td>{formatNumber(total.requests)}</td>
                          <td>{formatNumber(total.impressions)}</td>
                          <td>{formatPercent(fr)}</td>
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
                            {supplier.siteDrilldown.map((site) => (
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
                      </div>
                    </details>
                  );
                })}
              </div>
            ) : (
              <div className="workspace-note">目前沒有異常供應商，請調整顯示模式或確認資料。</div>
            )}
          </Panel>
        </div>
      ) : null}
    </Panel>
  );
}
