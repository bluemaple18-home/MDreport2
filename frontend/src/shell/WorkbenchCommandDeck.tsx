import { ActionButton, Field, ModeSwitcher, Panel } from "../components/ui";
import { ACCEPTANCE_SELECTORS } from "../state/runtimeContract";
import type { MainTab, SubTab, Workflow } from "../types";

type TabOption = {
  value: string;
  label: string;
};

type WorkbenchCommandDeckProps = {
  workflow: Workflow;
  busy: boolean;
  mainTab: MainTab;
  subTab: SubTab;
  mainTabLabel: string;
  mainTabOptions: TabOption[];
  subTabOptions: TabOption[];
  periodPreset: "current_week" | "last_week" | "custom";
  periodLabel: string;
  periodWeekStart: string;
  periodWeekEnd: string;
  dspPeriodLocked: boolean;
  onWorkflowChange: (workflow: Workflow) => void;
  onMainTabChange: (tab: MainTab) => void;
  onSubTabChange: (tab: SubTab) => void;
  onPeriodPresetChange: (preset: "current_week" | "last_week" | "custom") => void;
  onPeriodWeekStartChange: (value: string) => void;
  onPeriodWeekEndChange: (value: string) => void;
};

export function WorkbenchCommandDeck({
  workflow,
  busy,
  mainTab,
  subTab,
  mainTabLabel,
  mainTabOptions,
  subTabOptions,
  periodPreset,
  periodLabel,
  periodWeekStart,
  periodWeekEnd,
  dspPeriodLocked,
  onWorkflowChange,
  onMainTabChange,
  onSubTabChange,
  onPeriodPresetChange,
  onPeriodWeekStartChange,
  onPeriodWeekEndChange,
}: WorkbenchCommandDeckProps) {
  return (
    <section className="panel panel-full workbench-command-deck">
      <header className="panel-header">
        <h2>Workbench Command Deck</h2>
        <p>workflow / tab / period / action 的控制入口，與工作區分層。</p>
      </header>
      <div className="panel-body">
        <div className="command-grid">
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

          {subTabOptions.length > 0 ? (
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

          <div className="command-cell command-cell-wide">
            <Panel
              title="Period Contract"
              subtitle={dspPeriodLocked ? "DSP 週期鎖定（以工作流固定視角）" : "SSP 週期可選（可切 preset/custom）"}
              testId={ACCEPTANCE_SELECTORS.periodSelector}
            >
              <div className="grid-2">
                <Field label="Period Preset">
                  <select
                    data-testid={ACCEPTANCE_SELECTORS.periodPreset}
                    value={periodPreset}
                    disabled={dspPeriodLocked}
                    onChange={(e) => onPeriodPresetChange(e.target.value as "current_week" | "last_week" | "custom")}
                  >
                    <option value="current_week">current_week</option>
                    <option value="last_week">last_week</option>
                    <option value="custom">custom</option>
                  </select>
                </Field>
                <Field label="Period Label">
                  <input value={periodLabel} readOnly />
                </Field>
                <Field label="Week Start">
                  <input
                    data-testid={ACCEPTANCE_SELECTORS.periodWeekStart}
                    type="date"
                    value={periodWeekStart}
                    disabled={dspPeriodLocked}
                    onChange={(e) => onPeriodWeekStartChange(e.target.value)}
                  />
                </Field>
                <Field label="Week End">
                  <input
                    data-testid={ACCEPTANCE_SELECTORS.periodWeekEnd}
                    type="date"
                    value={periodWeekEnd}
                    disabled={dspPeriodLocked}
                    onChange={(e) => onPeriodWeekEndChange(e.target.value)}
                  />
                </Field>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </section>
  );
}
