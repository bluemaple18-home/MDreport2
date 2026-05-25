import type { MainTab, RouteState, SubTab, Workflow } from "../types";

export type RawdataCapability = {
  mode: "editable" | "read_only";
  canEdit: boolean;
  readOnly: boolean;
  readOnlyReason: string;
};

export type WorkflowCapability = {
  workflow: Workflow;
  rawdata: RawdataCapability;
  periodLocked: boolean;
  sspParityEnabled: boolean;
  tab4MainTab: MainTab | "";
  tab4VisibleSubTabs: SubTab[];
};

export type WorkspaceVisibilityCapability = {
  showSspParity: boolean;
  showTab4Workspace: boolean;
};

const WORKFLOW_CAPABILITY_MAP: Record<Workflow, WorkflowCapability> = {
  dsp: {
    workflow: "dsp",
    rawdata: {
      mode: "editable",
      canEdit: true,
      readOnly: false,
      readOnlyReason: "",
    },
    periodLocked: false,
    sspParityEnabled: false,
    tab4MainTab: "dsp_tab4",
    tab4VisibleSubTabs: ["overview", "pivot"],
  },
  ssp: {
    workflow: "ssp",
    rawdata: {
      mode: "read_only",
      canEdit: false,
      readOnly: true,
      readOnlyReason: "SSP 目前為 read-only，僅提供檢視、篩選與核對。",
    },
    periodLocked: false,
    sspParityEnabled: false,
    tab4MainTab: "",
    tab4VisibleSubTabs: [],
  },
  monthly: {
    workflow: "monthly",
    rawdata: {
      mode: "read_only",
      canEdit: false,
      readOnly: true,
      readOnlyReason: "月報使用 P4(J) 專用手 key 欄位與 snapshot，不直接編輯 rawdata。",
    },
    periodLocked: false,
    sspParityEnabled: false,
    tab4MainTab: "",
    tab4VisibleSubTabs: [],
  },
};

export function getWorkflowCapability(workflow: Workflow): WorkflowCapability {
  return WORKFLOW_CAPABILITY_MAP[workflow];
}

export function getWorkspaceVisibilityCapability(route: RouteState): WorkspaceVisibilityCapability {
  const workflowCapability = getWorkflowCapability(route.workflow);
  const showSspParity = workflowCapability.sspParityEnabled;
  const showTab4Workspace =
    workflowCapability.tab4MainTab !== "" &&
    route.mainTab === workflowCapability.tab4MainTab &&
    workflowCapability.tab4VisibleSubTabs.includes(route.subTab);
  return {
    showSspParity,
    showTab4Workspace,
  };
}
