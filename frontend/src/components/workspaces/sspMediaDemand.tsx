import { useEffect, useMemo, useState } from "react";
import { fetchSspMediaDemand } from "../../api/runtimeApi";
import type { RuntimeContext, Workflow, SspMediaDemandConfig, SspMediaDemandSlot, SspMediaDemandView } from "../../types";
import { ActionButton, DataStateBlock, Field, Panel } from "../ui";
import type { RowData } from "./shared";
import { formatNumber, formatPercent } from "../../utils/format";

type SspMediaDemandWorkspaceProps = {
  rows: RowData[];
  workflow: Workflow;
  busy: boolean;
  periodWeekStart: string;
  periodWeekEnd: string;
  runtimeContext: RuntimeContext;
  config?: SspMediaDemandConfig;
  onSaveSlots: (slots: SspMediaDemandSlot[]) => Promise<boolean>;
};

type DemandMetricKey = "request" | "impression" | "fr" | "complianceRate";
type LocalSlot = SspMediaDemandSlot & { draftKey: string };
type MediaDemandColumn = {
  key: string;
  label: string;
  width: number;
};
type FixedColumnSpec = {
  key: string;
  label: string;
  width: number;
};

const MEDIA_DEMAND_COLUMN_WIDTH_MIN = 72;
const MEDIA_DEMAND_COLUMN_WIDTH_MAX = 360;
const MEDIA_DEMAND_REQUEST_WIDTH = 96;
const MEDIA_DEMAND_IMPRESSION_WIDTH = 96;
const MEDIA_DEMAND_FR_WIDTH = 74;
const MEDIA_DEMAND_COMPLIANCE_WIDTH = 92;
const MEDIA_DEMAND_COLUMN_WIDTH_STORAGE_KEY = "mdrep:ssp-media-demand-colwidths";
const MEDIA_DEMAND_SHOW_TARGET_STORAGE_KEY = "mdrep:ssp-media-demand-show-target";
const MEDIA_DEMAND_FIXED_COLUMNS: FixedColumnSpec[] = [
  { key: "fixed:placement_id", label: "版位", width: 110 },
  { key: "fixed:placement_name", label: "版位名稱", width: 260 },
  { key: "fixed:media_target", label: "媒體喊量", width: 150 },
];

const CATEGORY_FALLBACK = ["蓋板", "置底", "置底展開", "文中300x250", "文中320x480"];
const DEMAND_SCOPE_GROUPS: Array<{
  scope: "all" | "07-22";
  label: string;
  metrics: Array<{ key: Exclude<DemandMetricKey, "complianceRate">; label: string; formatter: (value: number) => string }>;
}> = [
  {
    scope: "all",
    label: "全時段",
    metrics: [
      { key: "request", label: "請求", formatter: formatNumber },
      { key: "impression", label: "曝光", formatter: formatNumber },
      { key: "fr", label: "FR", formatter: formatPercent },
    ],
  },
  {
    scope: "07-22",
    label: "0700-2200",
    metrics: [
      { key: "request", label: "請求", formatter: formatNumber },
      { key: "impression", label: "曝光", formatter: formatNumber },
      { key: "fr", label: "FR", formatter: formatPercent },
    ],
  },
];
const DEMAND_COMPLIANCE_COLUMN = {
  key: "complianceRate" as const,
  label: "合格請求%",
  formatter: formatPercent,
};

function metricColumnWidth(metricKey: Exclude<DemandMetricKey, "complianceRate">): number {
  if (metricKey === "fr") {
    return MEDIA_DEMAND_FR_WIDTH;
  }
  if (metricKey === "impression") {
    return MEDIA_DEMAND_IMPRESSION_WIDTH;
  }
  return MEDIA_DEMAND_REQUEST_WIDTH;
}

function safeText(value: unknown): string {
  return String(value ?? "").trim();
}

function safeNumber(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const raw = safeText(value).replace(/,/g, "");
  if (!raw) {
    return 0;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildDraftKey(slot: SspMediaDemandSlot, index: number): string {
  return `${slot.category}:${slot.slot_order}:${slot.placement_id || "blank"}:${slot.id || index}`;
}

function resolveDayLimit(startDate: string, endDate: string): number {
  if (!startDate || !endDate) {
    return 14;
  }
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const startTime = start.getTime();
  const endTime = end.getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
    return 14;
  }
  const diffDays = Math.floor((endTime - startTime) / 86400000) + 1;
  return Math.max(1, diffDays);
}

function clampMediaDemandColumnWidth(width: number): number {
  return Math.max(MEDIA_DEMAND_COLUMN_WIDTH_MIN, Math.min(MEDIA_DEMAND_COLUMN_WIDTH_MAX, Math.round(width)));
}

function loadStoredMediaDemandColumnWidths(): Record<string, number> {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(MEDIA_DEMAND_COLUMN_WIDTH_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        out[key] = clampMediaDemandColumnWidth(value);
      }
    }
    return out;
  } catch {
    return {};
  }
}

function toLocalSlots(slots: SspMediaDemandSlot[]): LocalSlot[] {
  return slots.map((slot, index) => ({
    ...slot,
    media_quality: safeText(slot.media_quality),
    need_call: Boolean(slot.need_call),
    target_fr: safeText(slot.target_fr),
    remark: safeText(slot.remark),
    media_target: safeNumber(slot.media_target),
    draftKey: buildDraftKey(slot, index),
  }));
}

function stripDraft(slot: LocalSlot): SspMediaDemandSlot {
  return {
    id: slot.id,
    runtime_env: slot.runtime_env,
    category: slot.category,
    slot_order: slot.slot_order,
    placement_id: safeText(slot.placement_id),
    placement_name: safeText(slot.placement_name),
    media_quality: safeText(slot.media_quality),
    need_call: Boolean(slot.need_call),
    target_fr: safeText(slot.target_fr),
    remark: safeText(slot.remark),
    media_target: safeNumber(slot.media_target),
    is_active: Boolean(slot.is_active),
  };
}

export function SspMediaDemandWorkspace({
  rows,
  workflow,
  busy,
  periodWeekStart,
  periodWeekEnd,
  runtimeContext,
  config,
  onSaveSlots,
}: SspMediaDemandWorkspaceProps) {
  const [viewConfig, setViewConfig] = useState<SspMediaDemandConfig | null>(null);
  const categories = useMemo(
    () => {
      if (config?.categories && config.categories.length > 0) {
        return config.categories;
      }
      if (viewConfig?.categories && viewConfig.categories.length > 0) {
        return viewConfig.categories;
      }
      return CATEGORY_FALLBACK;
    },
    [config?.categories, viewConfig?.categories],
  );
  const [activeCategory, setActiveCategory] = useState<string>(categories[0] || CATEGORY_FALLBACK[0]);
  const [draftSlots, setDraftSlots] = useState<LocalSlot[]>(() => toLocalSlots(config?.slots || []));
  const [onlyUnmet, setOnlyUnmet] = useState<boolean>(false);
  const [scopeMode, setScopeMode] = useState<"all" | "07-22">("all");
  const [selectedSource, setSelectedSource] = useState<string>("__all__");
  const [showMediaTarget, setShowMediaTarget] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    const stored = window.localStorage.getItem(MEDIA_DEMAND_SHOW_TARGET_STORAGE_KEY);
    if (stored == null) {
      return false;
    }
    return stored !== "0";
  });
  const [threshold, setThreshold] = useState<number>(() => {
    const raw = window.localStorage.getItem("mdrep:ssp-media-threshold");
    const parsed = Number(raw || "100");
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 100;
  });
  const [editorOpen, setEditorOpen] = useState<boolean>(false);
  const [summaryOpen, setSummaryOpen] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<string>("");
  const [viewLoading, setViewLoading] = useState<boolean>(false);
  const [viewError, setViewError] = useState<string>("");
  const [viewData, setViewData] = useState<SspMediaDemandView | null>(null);
  const [refreshNonce, setRefreshNonce] = useState<number>(0);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => loadStoredMediaDemandColumnWidths());
  const [activeResize, setActiveResize] = useState<{ key: string; startX: number; startWidth: number } | null>(null);
  const resolvedConfigSlots = useMemo(
    () => (config?.slots && config.slots.length > 0 ? config.slots : viewConfig?.slots || []),
    [config?.slots, viewConfig?.slots],
  );
  const effectiveDayLimit = useMemo(
    () => resolveDayLimit(periodWeekStart, periodWeekEnd),
    [periodWeekEnd, periodWeekStart],
  );

  useEffect(() => {
    setDraftSlots(toLocalSlots(resolvedConfigSlots));
  }, [resolvedConfigSlots]);

  useEffect(() => {
    if (!categories.includes(activeCategory)) {
      setActiveCategory(categories[0] || CATEGORY_FALLBACK[0]);
    }
  }, [activeCategory, categories]);

  useEffect(() => {
    window.localStorage.setItem("mdrep:ssp-media-threshold", String(threshold));
  }, [threshold]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(MEDIA_DEMAND_SHOW_TARGET_STORAGE_KEY, showMediaTarget ? "1" : "0");
  }, [showMediaTarget]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(MEDIA_DEMAND_COLUMN_WIDTH_STORAGE_KEY, JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    if (!activeResize) {
      return undefined;
    }
    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth = clampMediaDemandColumnWidth(activeResize.startWidth + (event.clientX - activeResize.startX));
      setColumnWidths((current) => ({ ...current, [activeResize.key]: nextWidth }));
    };
    const handleMouseUp = () => setActiveResize(null);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [activeResize]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!activeCategory || !periodWeekStart || !periodWeekEnd) {
        return;
      }
      setViewLoading(true);
      setViewError("");
      const result = await fetchSspMediaDemand(runtimeContext, {
        category: activeCategory,
        source: selectedSource,
        period_week_start: periodWeekStart,
        period_week_end: periodWeekEnd,
        scope_mode: scopeMode,
        day_limit: effectiveDayLimit,
        threshold,
        only_unmet: onlyUnmet,
      });
      if (cancelled) {
        return;
      }
      if (result.status !== "ok" || !result.result) {
        setViewData(null);
        setViewError(result.message || "載入媒體要量失敗");
      } else {
        setViewConfig(result.result.config);
        setViewData(result.result.view);
      }
      setViewLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [
    activeCategory,
    effectiveDayLimit,
    onlyUnmet,
    periodWeekEnd,
    periodWeekStart,
    refreshNonce,
    runtimeContext,
    scopeMode,
    selectedSource,
    threshold,
  ]);

  const sourceOptions = useMemo(() => {
    const options = viewData?.source_options || [];
    return ["__all__", ...options];
  }, [viewData?.source_options]);

  useEffect(() => {
    if (!sourceOptions.includes(selectedSource)) {
      setSelectedSource("__all__");
    }
  }, [selectedSource, sourceOptions]);

  const categorySlots = useMemo(
    () => draftSlots
      .filter((slot) => slot.category === activeCategory)
      .sort((left, right) => left.slot_order - right.slot_order),
    [activeCategory, draftSlots],
  );
  const configCategorySlots = useMemo(
    () => toLocalSlots(resolvedConfigSlots)
      .filter((slot) => slot.category === activeCategory)
      .sort((left, right) => left.slot_order - right.slot_order),
    [activeCategory, resolvedConfigSlots],
  );
  const editorSlots = categorySlots.length > 0 ? categorySlots : configCategorySlots;
  const activeCategoryLabel = activeCategory || "未選擇群組";
  const visibleFixedColumns = useMemo(
    () => MEDIA_DEMAND_FIXED_COLUMNS.filter((column) => showMediaTarget || column.key !== "fixed:media_target"),
    [showMediaTarget],
  );
  const tableLeafColumns = useMemo<MediaDemandColumn[]>(() => {
    const dateKeys = viewData?.date_keys || [];
    return [
      ...visibleFixedColumns,
      ...dateKeys.flatMap((dateKey) => [
        ...DEMAND_SCOPE_GROUPS.flatMap((group) => group.metrics.map((metric) => ({
          key: `${dateKey}:${group.scope}:${metric.key}`,
          label: metric.label,
          width: metricColumnWidth(metric.key),
        }))),
        {
          key: `${dateKey}:complianceRate`,
          label: DEMAND_COMPLIANCE_COLUMN.label,
          width: MEDIA_DEMAND_COMPLIANCE_WIDTH,
        },
      ]),
    ];
  }, [viewData?.date_keys, visibleFixedColumns]);

  const tableTotals = useMemo(() => {
    const dateKeys = viewData?.date_keys || [];
    const rowsForTotal = viewData?.rows || [];
    const totalsByDate: Record<string, Record<"all" | "07-22", { request: number; impression: number; complianceRate: number; fr: number; ctr: number; ecpm: number }>> = {};
    let mediaTargetTotal = 0;
    for (const dateKey of dateKeys) {
      totalsByDate[dateKey] = {
        all: { request: 0, impression: 0, complianceRate: 0, fr: 0, ctr: 0, ecpm: 0 },
        "07-22": { request: 0, impression: 0, complianceRate: 0, fr: 0, ctr: 0, ecpm: 0 },
      };
    }
    for (const row of rowsForTotal) {
      mediaTargetTotal += safeNumber(row.slot?.media_target);
      for (const dateKey of dateKeys) {
        const bucket = totalsByDate[dateKey];
        if (!bucket) {
          continue;
        }
        for (const scope of ["all", "07-22"] as const) {
          const metrics = row.metrics_by_date?.[dateKey]?.[scope] || {};
          bucket[scope].request += safeNumber(metrics.request);
          bucket[scope].impression += safeNumber(metrics.impression);
          bucket[scope].ctr += safeNumber(metrics.ctr);
          bucket[scope].ecpm += safeNumber(metrics.ecpm);
        }
      }
    }
    for (const dateKey of dateKeys) {
      const bucket = totalsByDate[dateKey];
      if (!bucket) {
        continue;
      }
      for (const scope of ["all", "07-22"] as const) {
        const item = bucket[scope];
        item.fr = item.request > 0 ? (item.impression / item.request) * 100 : 0;
        item.complianceRate = mediaTargetTotal > 0 ? (item.request / mediaTargetTotal) * 100 : 0;
      }
    }
    return { mediaTargetTotal, totalsByDate, rowCount: rowsForTotal.length };
  }, [viewData?.date_keys, viewData?.rows]);

  const updateSlot = (draftKey: string, patch: Partial<LocalSlot>) => {
    setDraftSlots((current) => current.map((slot) => (slot.draftKey === draftKey ? { ...slot, ...patch } : slot)));
  };

  const addSlot = () => {
    const nextOrder = editorSlots
      .reduce((max, slot) => Math.max(max, slot.slot_order), -1) + 1;
    const timestamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (draftSlots.length === 0 && configCategorySlots.length > 0) {
      setDraftSlots(toLocalSlots(resolvedConfigSlots));
    }
    setDraftSlots((current) => current.concat({
      category: activeCategory,
      slot_order: nextOrder,
      placement_id: "",
      placement_name: "",
      media_quality: "",
      need_call: false,
      target_fr: "",
      remark: "",
      media_target: 0,
      is_active: true,
      draftKey: `${activeCategory}:${nextOrder}:${timestamp}`,
    }));
  };

  const removeSlot = (draftKey: string) => {
    setDraftSlots((current) => current.filter((slot) => slot.draftKey !== draftKey));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage("");
    const normalizedByCategory = categories.flatMap((category) => (
      draftSlots
        .filter((slot) => slot.category === category)
        .sort((left, right) => left.slot_order - right.slot_order)
        .map((slot, index) => stripDraft({ ...slot, slot_order: index }))
    ));
    const ok = await onSaveSlots(normalizedByCategory);
    setSaving(false);
    setSaveMessage(ok ? "固定版位槽位已保存並重算。" : "保存失敗，請稍後再試。");
    if (ok) {
      setRefreshNonce((current) => current + 1);
    }
  };

  return (
    <Panel title={`${workflow.toUpperCase()} 媒體要量 Workspace`} subtitle="固定版位槽位走 DB，日表直接由 ssp_raw 聚合計算。" full>
      <DataStateBlock loading={busy || viewLoading} error={viewError} empty={!busy && !viewLoading && !viewError && rows.length === 0} />

      {!busy ? (
        <div className="ssp-media-demand" data-testid="ssp-media-workbench">
          <Panel title="控制列" subtitle="與成效救火同層切換，媒體要量內再分五個子頁籤。">
            <div className="tab-row" data-testid="ssp-media-category-tabs">
              {categories.map((category) => (
                <ActionButton
                  key={category}
                  label={category}
                  onClick={() => setActiveCategory(category)}
                  variant={activeCategory === category ? "primary" : "ghost"}
                  role="tab"
                  ariaSelected={activeCategory === category}
                  testId={`ssp-media-category-${category}`}
                />
              ))}
            </div>
            <div className="ssp-media-active-summary" data-testid="ssp-media-active-category">
              <strong>目前群組：</strong>
              <span>{activeCategoryLabel}</span>
              <span className="ssp-media-active-summary-divider">|</span>
              <strong>槽位數：</strong>
              <span>{formatNumber(editorSlots.length)}</span>
              {viewLoading ? (
                <>
                  <span className="ssp-media-active-summary-divider">|</span>
                  <span className="ssp-media-active-loading">切換中...</span>
                </>
              ) : null}
            </div>
            <div className="ssp-media-control-grid">
              <Field label="來源">
                <select
                  data-testid="ssp-media-source"
                  value={selectedSource}
                  onChange={(event) => setSelectedSource(event.target.value)}
                >
                  {sourceOptions.map((option) => (
                    <option key={option} value={option}>
                      {option === "__all__" ? "全部來源" : option}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="時段範圍">
                <div className="btn-row" data-testid="ssp-media-scope-mode">
                  <ActionButton
                    label="全時段"
                    variant={scopeMode === "all" ? "primary" : "ghost"}
                    onClick={() => setScopeMode("all")}
                    testId="ssp-media-scope-all"
                  />
                  <ActionButton
                    label="07-22"
                    variant={scopeMode === "07-22" ? "primary" : "ghost"}
                    onClick={() => setScopeMode("07-22")}
                    testId="ssp-media-scope-07-22"
                  />
                </div>
              </Field>
              <Field label="合格率閥值(%)">
                <input
                  data-testid="ssp-media-threshold"
                  type="number"
                  min="0"
                  step="5"
                  value={String(threshold)}
                  onChange={(event) => setThreshold(safeNumber(event.target.value))}
                />
              </Field>
              <label className="ssp-media-toggle" data-testid="ssp-media-show-target-toggle">
                <input type="checkbox" checked={showMediaTarget} onChange={(event) => setShowMediaTarget(event.target.checked)} />
                <span>顯示媒體喊量</span>
              </label>
              <label className="ssp-media-toggle" data-testid="ssp-media-only-unmet-toggle">
                <input type="checkbox" checked={onlyUnmet} onChange={(event) => setOnlyUnmet(event.target.checked)} />
                <span>只顯示未達標</span>
              </label>
            </div>
            <div className="ssp-media-editor-block">
              <div className="ssp-media-editor-copy">
                <strong>固定版位槽位</strong>
                <span>新增的是槽位，不是 raw row；改完保存後立即重算。</span>
              </div>
              <div className="ssp-media-editor-actions">
              <ActionButton
                label={editorOpen ? "收合編輯區" : "展開編輯區"}
                variant="ghost"
                onClick={() => setEditorOpen((current) => !current)}
                testId="ssp-media-toggle-slot-editor"
              />
              <ActionButton label="新增槽位" variant="ghost" onClick={addSlot} testId="ssp-media-add-slot" />
              <ActionButton label={saving ? "保存中..." : "保存槽位"} onClick={() => void handleSave()} disabled={saving} testId="ssp-media-save-slots" />
              </div>
            </div>
            {saveMessage ? <p className="workspace-note">{saveMessage}</p> : null}
            {editorOpen ? (
              <div className="table-wrap table-wrap-compact" data-testid="ssp-media-slot-editor">
                <table className="ssp-media-slot-table">
                  <thead>
                    <tr>
                      <th>槽位</th>
                      <th>版位</th>
                      <th>版位名稱</th>
                      <th>媒體質量</th>
                      <th>需喊量</th>
                      <th>目標FR</th>
                      <th>預估量(7-22點)</th>
                      <th>Remark</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {editorSlots.map((slot, index) => (
                      <tr key={slot.draftKey}>
                        <td>{index + 1}</td>
                        <td>
                          <input
                            value={slot.placement_id}
                            onChange={(event) => updateSlot(slot.draftKey, { placement_id: event.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            value={slot.placement_name}
                            onChange={(event) => updateSlot(slot.draftKey, { placement_name: event.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            value={slot.media_quality || ""}
                            onChange={(event) => updateSlot(slot.draftKey, { media_quality: event.target.value })}
                          />
                        </td>
                        <td>
                          <select
                            value={slot.need_call ? "true" : "false"}
                            onChange={(event) => updateSlot(slot.draftKey, { need_call: event.target.value === "true" })}
                          >
                            <option value="true">true</option>
                            <option value="false">false</option>
                          </select>
                        </td>
                        <td>
                          <input
                            value={slot.target_fr || ""}
                            onChange={(event) => updateSlot(slot.draftKey, { target_fr: event.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={String(slot.media_target)}
                            onChange={(event) => updateSlot(slot.draftKey, { media_target: safeNumber(event.target.value) })}
                          />
                        </td>
                        <td>
                          <input
                            value={slot.remark}
                            onChange={(event) => updateSlot(slot.draftKey, { remark: event.target.value })}
                          />
                        </td>
                        <td>
                          <ActionButton label="移除" variant="ghost" onClick={() => removeSlot(slot.draftKey)} />
                        </td>
                      </tr>
                    ))}
                    {editorSlots.length === 0 ? (
                      <tr>
                        <td colSpan={9}>目前沒有槽位，先新增一個版位槽。</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Panel>

          <Panel title="每日寬表" subtitle="最新日期在左；低於閥值且大於 0 的合格率會標紅。">
            <div className="table-wrap ssp-media-demand-table-wrap" data-testid="ssp-media-demand-table">
              <table className="ssp-media-demand-table">
                <colgroup>
                  {tableLeafColumns.map((column) => {
                    const width = columnWidths[column.key] ?? column.width;
                    return <col key={column.key} style={{ width: `${width}px`, minWidth: `${width}px` }} />;
                  })}
                </colgroup>
                <thead>
                  <tr>
                    {visibleFixedColumns.map((column) => (
                      <th key={column.key} rowSpan={3}>
                        <div className="ssp-media-th-content">
                          <button
                            type="button"
                            className="ssp-media-col-resizer"
                            aria-label={`${column.label} 欄寬調整`}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              setActiveResize({
                                key: column.key,
                                startX: event.clientX,
                                startWidth: columnWidths[column.key] ?? column.width,
                              });
                            }}
                          />
                          <span className="ssp-media-th-label">{column.label}</span>
                        </div>
                      </th>
                    ))}
                    {(viewData?.date_keys || []).map((dateKey) => (
                      <th key={`${dateKey}-date`} colSpan={7}>{dateKey}</th>
                    ))}
                  </tr>
                  <tr>
                    {(viewData?.date_keys || []).flatMap((dateKey) => ([
                      <th key={`${dateKey}-all`} colSpan={3}>全時段</th>,
                      <th key={`${dateKey}-0722`} colSpan={3}>0700-2200</th>,
                      <th key={`${dateKey}-qualified`} rowSpan={2}>{DEMAND_COMPLIANCE_COLUMN.label}</th>,
                    ]))}
                  </tr>
                  <tr>
                    {(viewData?.date_keys || []).flatMap((dateKey) => DEMAND_SCOPE_GROUPS.flatMap((group) => group.metrics.map((metric) => (
                      <th key={`${dateKey}-${group.scope}-${metric.key}`}>
                        <div className="ssp-media-th-content">
                          <button
                            type="button"
                            className="ssp-media-col-resizer"
                            aria-label={`${dateKey} ${group.label} ${metric.label} 欄寬調整`}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              setActiveResize({
                                key: `${dateKey}:${group.scope}:${metric.key}`,
                                startX: event.clientX,
                                startWidth: columnWidths[`${dateKey}:${group.scope}:${metric.key}`] ?? metricColumnWidth(metric.key),
                              });
                            }}
                          />
                          <span className="ssp-media-th-label">{metric.label}</span>
                        </div>
                      </th>
                    ))))}
                  </tr>
                </thead>
                <tbody>
                  {(viewData?.rows || []).map((row) => (
                    <tr key={`${row.slot.category}:${row.slot.slot_order}:${row.slot.placement_id || "blank"}`} className={!safeText(row.slot.placement_id) ? "ssp-media-row-empty" : ""}>
                      <td>{row.slot.placement_id || ""}</td>
                      <td>{row.slot.placement_name || ""}</td>
                      {showMediaTarget ? <td>{formatNumber(row.slot.media_target)}</td> : null}
                      {(viewData?.date_keys || []).flatMap((dateKey) => ([
                        ...DEMAND_SCOPE_GROUPS.flatMap((group) => group.metrics.map((metric) => {
                          const value = row.metrics_by_date[dateKey]?.[group.scope]?.[metric.key] || 0;
                          return (
                            <td key={`${row.slot.category}:${row.slot.slot_order}:${dateKey}:${group.scope}:${metric.key}`}>
                              {metric.formatter(value)}
                            </td>
                          );
                        })),
                        (() => {
                          const value = row.metrics_by_date[dateKey]?.all?.[DEMAND_COMPLIANCE_COLUMN.key] || 0;
                          const isRed = value > 0 && value < threshold;
                          return (
                            <td key={`${row.slot.category}:${row.slot.slot_order}:${dateKey}:complianceRate`} className={isRed ? "ssp-media-cell-unmet" : ""}>
                              {DEMAND_COMPLIANCE_COLUMN.formatter(value)}
                            </td>
                          );
                        })(),
                      ]))}
                    </tr>
                  ))}
                  {((viewData?.rows || []).length === 0) ? (
                    <tr>
                      <td colSpan={visibleFixedColumns.length + ((viewData?.date_keys || []).length * 7)}>目前條件下沒有可顯示的版位。</td>
                    </tr>
                  ) : null}
                </tbody>
                <tfoot>
                  <tr className="table-total-row">
                    <td>總計</td>
                    <td />
                    {showMediaTarget ? <td>{formatNumber(tableTotals.mediaTargetTotal)}</td> : null}
                    {(viewData?.date_keys || []).flatMap((dateKey) => ([
                      ...DEMAND_SCOPE_GROUPS.flatMap((group) => group.metrics.map((metric) => {
                        const value = tableTotals.totalsByDate[dateKey]?.[group.scope]?.[metric.key] || 0;
                        return (
                          <td key={`total-${dateKey}-${group.scope}-${metric.key}`}>
                            {metric.formatter(value)}
                          </td>
                        );
                      })),
                      <td key={`total-${dateKey}-complianceRate`}>
                        {DEMAND_COMPLIANCE_COLUMN.formatter(tableTotals.totalsByDate[dateKey]?.all?.complianceRate || 0)}
                      </td>,
                    ]))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </Panel>

          <Panel title="其他資訊" subtitle="不常用資訊先收到底部。">
            <div className="ssp-media-editor-block ssp-media-summary-block">
              <div className="ssp-media-editor-copy">
                <strong>查詢摘要與量體總覽</strong>
                <span>包含日期區間、來源狀態與聚合摘要。</span>
              </div>
              <div className="ssp-media-editor-actions">
                <ActionButton
                  label={summaryOpen ? "收合資訊" : "展開資訊"}
                  variant="ghost"
                  onClick={() => setSummaryOpen((current) => !current)}
                  testId="ssp-media-toggle-summary"
                />
              </div>
            </div>
            {summaryOpen ? (
              <>
                <div className="status-bar">
                  <span>日期區間: {periodWeekStart} ~ {periodWeekEnd}</span>
                  <span>目前來源: {viewData?.source === "__all__" ? "全部來源" : (viewData?.source || "n/a")}</span>
                  <span>目前時段: {viewData?.scope_mode === "07-22" ? "07-22" : "全時段"}</span>
                  <span>預設來源: {config?.defaults_source || "n/a"}</span>
                  <span>儲存來源: {config?.storage_source || "n/a"}</span>
                  <span>來源數: {formatNumber(Math.max(0, sourceOptions.length - 1))}</span>
                </div>
                <div className="metrics-grid" data-testid="ssp-media-kpi">
                  <div className="metric-card">
                    <h3>最新日期</h3>
                    <div className="metric-list">
                      <span>{viewData?.latest_date || "n/a"}</span>
                    </div>
                  </div>
                  <div className="metric-card">
                    <h3>目前槽位</h3>
                    <div className="metric-list">
                      <span>{formatNumber(categorySlots.length)}</span>
                    </div>
                  </div>
                  <div className="metric-card">
                    <h3>最新請求</h3>
                    <div className="metric-list">
                      <span>{formatNumber(viewData?.latest_total_request || 0)}</span>
                    </div>
                  </div>
                  <div className="metric-card">
                    <h3>未達標</h3>
                    <div className="metric-list">
                      <span>{formatNumber(viewData?.unmet_count || 0)}</span>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </Panel>
        </div>
      ) : null}
    </Panel>
  );
}
