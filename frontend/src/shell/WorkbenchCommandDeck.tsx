import { useEffect, useMemo, useRef, useState } from "react";
import { ActionButton, Field, ModeSwitcher, Panel } from "../components/ui";
import { ACCEPTANCE_SELECTORS } from "../state/runtimeContract";
import type { MainTab, PeriodPreset, SubTab, Workflow } from "../types";
import { buildDspDateOptions } from "./dspRawdataFilters";

type TabOption = {
  value: string;
  label: string;
};

type WorkbenchCommandDeckProps = {
  healthStatus: string;
  workflow: Workflow;
  busy: boolean;
  mainTab: MainTab;
  subTab: SubTab;
  mainTabLabel: string;
  mainTabOptions: TabOption[];
  subTabOptions: TabOption[];
  periodPreset: PeriodPreset;
  periodWeekStart: string;
  periodWeekEnd: string;
  dspPeriodLocked: boolean;
  onWorkflowChange: (workflow: Workflow) => void;
  onMainTabChange: (tab: MainTab) => void;
  onSubTabChange: (tab: SubTab) => void;
  onPeriodPresetChange: (preset: PeriodPreset) => void;
  onPeriodRangeChange: (weekStart: string, weekEnd: string) => void;
};

type CalendarDay = {
  iso: string;
  dayOfMonth: number;
  inMonth: boolean;
};

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, offset: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function buildCalendarDays(month: Date): CalendarDay[] {
  const monthStart = startOfMonth(month);
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - monthStart.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const current = new Date(gridStart);
    current.setDate(gridStart.getDate() + index);
    return {
      iso: formatIsoDate(current),
      dayOfMonth: current.getDate(),
      inMonth: current.getMonth() === monthStart.getMonth(),
    };
  });
}

function formatMonthTitle(date: Date): string {
  return `${date.getFullYear()} / ${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function buildRangeLabel(start: string, end: string): string {
  if (!start || !end) {
    return "選擇日期區間";
  }
  return `${start} - ${end}`;
}

function isDateWithinRange(dateIso: string, start: string, end: string): boolean {
  if (!start || !end) {
    return false;
  }
  return dateIso >= start && dateIso <= end;
}

type SspDateRangePickerProps = {
  start: string;
  end: string;
  disabled: boolean;
  onChange: (start: string, end: string) => void;
};

function SspDateRangePicker({ start, end, disabled, onChange }: SspDateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [anchorMonth, setAnchorMonth] = useState<Date>(() => startOfMonth(parseIsoDate(start) || new Date()));
  const [draftStart, setDraftStart] = useState(start);
  const [draftEnd, setDraftEnd] = useState(end);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const activeStart = open ? draftStart : start;
  const activeEnd = open ? draftEnd : end;
  const monthCards = useMemo(() => {
    const firstMonth = anchorMonth;
    const secondMonth = addMonths(anchorMonth, 1);
    return [firstMonth, secondMonth].map((month) => ({
      title: formatMonthTitle(month),
      days: buildCalendarDays(month),
    }));
  }, [anchorMonth]);

  useEffect(() => {
    if (!open) {
      setDraftStart(start);
      setDraftEnd(end);
      setAnchorMonth(startOfMonth(parseIsoDate(start) || new Date()));
    }
  }, [end, open, start]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  const handleDayClick = (selectedDate: string) => {
    if (disabled) {
      return;
    }
    if (!draftStart || draftEnd) {
      setDraftStart(selectedDate);
      setDraftEnd("");
      return;
    }
    const nextStart = selectedDate < draftStart ? selectedDate : draftStart;
    const nextEnd = selectedDate < draftStart ? draftStart : selectedDate;
    setDraftStart(nextStart);
    setDraftEnd(nextEnd);
    onChange(nextStart, nextEnd);
    setOpen(false);
  };

  return (
    <div className="period-range-picker" ref={rootRef}>
      <button
        type="button"
        className="period-range-trigger"
        data-testid={ACCEPTANCE_SELECTORS.periodRangeToggle}
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-expanded={open}
      >
        <span>{buildRangeLabel(start, end)}</span>
        <span className="period-range-trigger-icon">calendar</span>
      </button>
      {open ? (
        <div className="period-range-popover" data-testid={ACCEPTANCE_SELECTORS.periodRangePopover}>
          <div className="period-range-toolbar">
            <ActionButton
              label="上個月"
              variant="ghost"
              onClick={() => setAnchorMonth((current) => addMonths(current, -1))}
              disabled={disabled}
            />
            <span className="period-range-status">
              {draftStart && !draftEnd ? "再點一天作為結束日期" : buildRangeLabel(activeStart, activeEnd)}
            </span>
            <ActionButton
              label="下個月"
              variant="ghost"
              onClick={() => setAnchorMonth((current) => addMonths(current, 1))}
              disabled={disabled}
            />
          </div>
          <div className="period-range-months">
            {monthCards.map((month) => (
              <section key={month.title} className="period-range-month">
                <header className="period-range-month-title">{month.title}</header>
                <div className="period-range-weekdays">
                  {["日", "一", "二", "三", "四", "五", "六"].map((weekday) => (
                    <span key={weekday}>{weekday}</span>
                  ))}
                </div>
                <div className="period-range-grid">
                  {month.days.map((day) => {
                    const isStart = activeStart === day.iso;
                    const isEnd = activeEnd === day.iso;
                    const isInRange = isDateWithinRange(day.iso, activeStart, activeEnd);
                    const className = [
                      "period-range-day",
                      day.inMonth ? "" : "period-range-day-outside",
                      isInRange ? "period-range-day-in-range" : "",
                      isStart || isEnd ? "period-range-day-edge" : "",
                    ].filter(Boolean).join(" ");
                    return (
                      <button
                        key={day.iso}
                        type="button"
                        className={className}
                        data-testid={`period-range-day-${day.iso}`}
                        onClick={() => handleDayClick(day.iso)}
                      >
                        {day.dayOfMonth}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function WorkbenchCommandDeck({
  healthStatus,
  workflow,
  busy,
  mainTab,
  subTab,
  mainTabLabel,
  mainTabOptions,
  subTabOptions,
  periodPreset,
  periodWeekStart,
  periodWeekEnd,
  dspPeriodLocked,
  onWorkflowChange,
  onMainTabChange,
  onSubTabChange,
  onPeriodPresetChange,
  onPeriodRangeChange,
}: WorkbenchCommandDeckProps) {
  const isSspWorkflow = workflow === "ssp";
  const isMonthlyWorkflow = workflow === "monthly";
  const isMonthlyChartsTab = workflow === "monthly" && mainTab === "monthly_charts";
  const hasSubTabs = subTabOptions.length > 0;
  const periodPresetOptions = isSspWorkflow || isMonthlyWorkflow
    ? [
      { value: "current_month", label: "本月" },
      { value: "last_7_days", label: "最近 7 天" },
    ]
    : buildDspDateOptions();
  const periodSubtitle = isMonthlyWorkflow
    ? "月報素材依日期區間換算月份範圍，可自由控制要顯示的月份。"
    : isSspWorkflow
    ? "SSP 預設本月，可自由拉取日期區間"
    : "DSP 週期篩選（以完整週為單位）";
  const sspPeriodModeText = periodPreset === "custom" ? "目前：自訂區間" : periodPreset === "current_month" ? "目前：本月" : "目前：最近 7 天";
  const monthlyPeriodModeText = `最新月：${periodWeekEnd.slice(0, 7) || "未選"}`;

  return (
    <section className="panel panel-full workbench-command-deck">
      <header className="panel-header command-deck-header">
        <div className="command-deck-title">
          <h2>Workbench Command Deck</h2>
          <p>workflow / tab / period / action 的控制入口，與工作區分層。</p>
        </div>
        <div className="shell-status-summary" aria-label="MDREP Frontend Shell runtime status">
          <div className="shell-status-copy">
            <strong>MDREP Frontend Shell</strong>
            <span>SQLite canonical 是唯一真相來源；前端只調度 runtime API，不反寫 artifact。</span>
          </div>
          <div className="topline">
            <span className={`badge badge-${healthStatus === "ok" ? "ok" : "warn"}`}>health: {healthStatus}</span>
            <span className={`badge badge-${busy ? "busy" : "idle"}`}>{busy ? "running" : "idle"}</span>
          </div>
        </div>
      </header>
      <div className="panel-body">
        <div className={`command-grid${hasSubTabs ? "" : " command-grid-2up"}`}>
          <div className="command-cell" data-testid={ACCEPTANCE_SELECTORS.workflowSwitch}>
            <ModeSwitcher
              workflow={workflow}
              busy={busy}
              onChange={onWorkflowChange}
            />
            <div style={{ display: "none" }}>
              <span data-testid={ACCEPTANCE_SELECTORS.workflowUseDsp}>Use DSP</span>
              <span data-testid={ACCEPTANCE_SELECTORS.workflowUseSsp}>Use SSP</span>
            </div>
          </div>

          <div className="command-cell">
            <Panel
              title="Main Tabs"
              subtitle={`${workflow.toUpperCase()} 工作台主頁籤`}
              testId={ACCEPTANCE_SELECTORS.mainTabs}
            >
              <div className="btn-row" role="tablist" aria-label="Main tabs">
                {mainTabOptions.map((tab) => {
                  let testId = "";
                  if (tab.value === "dsp_tab3") testId = ACCEPTANCE_SELECTORS.mainTabDspTab3;
                  if (tab.value === "dsp_tab4") testId = ACCEPTANCE_SELECTORS.mainTabDspTab4;
                  if (tab.value === "ssp_anomaly") testId = ACCEPTANCE_SELECTORS.mainTabSspAnomaly;
                  if (tab.value === "ssp_media_demand") testId = ACCEPTANCE_SELECTORS.mainTabSspMediaDemand;
                  if (tab.value === "ssp_ad_group") testId = ACCEPTANCE_SELECTORS.mainTabSspAdGroup;
                  if (tab.value === "monthly_p4") testId = ACCEPTANCE_SELECTORS.mainTabMonthlyP4;
                  if (tab.value === "monthly_charts") testId = ACCEPTANCE_SELECTORS.mainTabMonthlyCharts;
                  return (
                    <ActionButton
                      key={tab.value}
                      label={tab.label}
                      testId={testId}
                      variant={mainTab === tab.value ? "primary" : "ghost"}
                      onClick={() => onMainTabChange(tab.value as MainTab)}
                      disabled={busy}
                      role="tab"
                      ariaSelected={mainTab === tab.value}
                    />
                  );
                })}
              </div>
            </Panel>
          </div>

          {hasSubTabs ? (
            <div className="command-cell">
              <Panel
                title="Sub Tabs"
                subtitle={`${mainTabLabel} 子頁籤層級`}
                testId={ACCEPTANCE_SELECTORS.subTabs}
              >
                <div className="btn-row" role="tablist" aria-label="Sub tabs">
                  {subTabOptions.map((tab) => {
                    let testId = "";
                    if (tab.value === "overview") testId = ACCEPTANCE_SELECTORS.subTabOverview;
                    if (tab.value === "rawdata") testId = ACCEPTANCE_SELECTORS.subTabRawdata;
                    if (tab.value === "pivot") testId = ACCEPTANCE_SELECTORS.subTabPivot;
                    if (tab.value === "result") testId = ACCEPTANCE_SELECTORS.subTabResult;
                    return (
                      <ActionButton
                        key={tab.value}
                        label={tab.label}
                        testId={testId}
                        variant={subTab === tab.value ? "primary" : "ghost"}
                        onClick={() => onSubTabChange(tab.value as SubTab)}
                        disabled={busy}
                        role="tab"
                        ariaSelected={subTab === tab.value}
                      />
                    );
                  })}
                </div>
              </Panel>
            </div>
          ) : null}

          {!isMonthlyChartsTab ? (
          <div className="command-cell command-cell-wide">
            <Panel
              title="Period Contract"
              subtitle={periodSubtitle}
              testId={ACCEPTANCE_SELECTORS.periodSelector}
            >
              <div className={isSspWorkflow || isMonthlyWorkflow ? "grid-2" : "grid-1"}>
                {isSspWorkflow || isMonthlyWorkflow ? (
                  <Field label="Period Preset">
                    <div className="period-preset-stack">
                      {isMonthlyWorkflow ? (
                        <span className="period-mode-note">{monthlyPeriodModeText}</span>
                      ) : (
                        <div className="btn-row">
                          <ActionButton
                            label="本月"
                            variant={periodPreset === "current_month" ? "primary" : "ghost"}
                            onClick={() => onPeriodPresetChange("current_month")}
                            disabled={dspPeriodLocked}
                            testId={ACCEPTANCE_SELECTORS.periodPreset}
                          />
                          <ActionButton
                            label="最近 7 天"
                            variant={periodPreset === "last_7_days" ? "primary" : "ghost"}
                            onClick={() => onPeriodPresetChange("last_7_days")}
                            disabled={dspPeriodLocked}
                          />
                        </div>
                      )}
                      <span className="period-mode-note">{isMonthlyWorkflow ? "自訂月份區間" : sspPeriodModeText}</span>
                    </div>
                  </Field>
                ) : (
                  <Field label="日期時間">
                    <select
                      data-testid={ACCEPTANCE_SELECTORS.periodPreset}
                      value={periodPreset}
                      disabled={dspPeriodLocked}
                      onChange={(e) => onPeriodPresetChange(e.target.value as PeriodPreset)}
                    >
                      {periodPresetOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </Field>
                )}
                {isSspWorkflow || isMonthlyWorkflow ? (
                  <Field label="Date Range">
                    <SspDateRangePicker
                      start={periodWeekStart}
                      end={periodWeekEnd}
                      disabled={dspPeriodLocked}
                      onChange={onPeriodRangeChange}
                    />
                  </Field>
                ) : null}
              </div>
            </Panel>
          </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
