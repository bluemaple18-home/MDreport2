import type {
  ActionType,
  MainTab,
  RuntimeContext,
  RuntimeEnvelope,
  RuntimeFrameResult,
  SspMediaDemandResponse,
  RuntimeStatusResult,
  SspMediaDemandSlot,
  SubTab,
} from "../types";

function resolveApiBase(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL || "").trim();
  if (!raw) {
    return "";
  }
  return raw.replace(/\/+$/, "");
}

function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const base = resolveApiBase();
  return `${base}${normalizedPath}`;
}

function withQuery(ctx: RuntimeContext): string {
  const params = new URLSearchParams({
    root: ctx.root,
    env: ctx.env,
    manifest: ctx.manifest,
    workflow: ctx.workflow,
    template_version: ctx.template_version,
    rule_version: ctx.rule_version,
    artifact_root: ctx.artifact_root,
  });
  return params.toString();
}

export function buildExportDownloadUrl(
  ctx: RuntimeContext,
  artifactPath: string,
  route?: { main_tab?: MainTab; sub_tab?: SubTab },
): string {
  const params = new URLSearchParams({
    root: ctx.root,
    env: ctx.env,
    manifest: ctx.manifest,
    workflow: ctx.workflow,
    template_version: ctx.template_version,
    rule_version: ctx.rule_version,
    artifact_root: ctx.artifact_root,
    artifact_path: artifactPath,
  });
  if (route?.main_tab) {
    params.set("main_tab", route.main_tab);
  }
  if (route?.sub_tab) {
    params.set("sub_tab", route.sub_tab);
  }
  return `${buildApiUrl("/api/export/download")}?${params.toString()}`;
}

async function parseEnvelope<T>(resp: Response): Promise<RuntimeEnvelope<T>> {
  const payload = (await resp.json()) as RuntimeEnvelope<T>;
  if (!resp.ok) {
    return {
      status: "error",
      error_code: payload.error_code || "HTTP_ERROR",
      message: payload.message || `HTTP ${resp.status}`,
      details: payload.details,
      result: payload.result,
    };
  }
  return payload;
}

export async function fetchStatus(ctx: RuntimeContext): Promise<RuntimeEnvelope<RuntimeStatusResult>> {
  const resp = await fetch(`${buildApiUrl("/api/status")}?${withQuery(ctx)}`, { cache: "no-store" });
  return parseEnvelope<RuntimeStatusResult>(resp);
}

export async function fetchFrame(ctx: RuntimeContext): Promise<RuntimeEnvelope<RuntimeFrameResult>> {
  const resp = await fetch(`${buildApiUrl("/api/frame")}?${withQuery(ctx)}`, { cache: "no-store" });
  return parseEnvelope<RuntimeFrameResult>(resp);
}

export async function fetchSspMediaDemand(
  ctx: RuntimeContext,
  params: {
    category: string;
    source: string;
    period_week_start: string;
    period_week_end: string;
    scope_mode: "all" | "07-22";
    day_limit: number;
    threshold: number;
    only_unmet: boolean;
  },
): Promise<RuntimeEnvelope<SspMediaDemandResponse>> {
  const query = new URLSearchParams({
    ...Object.fromEntries(new URLSearchParams(withQuery(ctx)).entries()),
    category: params.category,
    source: params.source,
    period_week_start: params.period_week_start,
    period_week_end: params.period_week_end,
    scope_mode: params.scope_mode,
    day_limit: String(params.day_limit),
    threshold: String(params.threshold),
    only_unmet: String(params.only_unmet),
  });
  const resp = await fetch(`${buildApiUrl("/api/ssp/media-demand")}?${query.toString()}`, { cache: "no-store" });
  return parseEnvelope<SspMediaDemandResponse>(resp);
}

export type ActionPayload = {
  action: ActionType;
  main_tab?: MainTab;
  sub_tab?: SubTab;
  rows?: Array<Record<string, unknown>>;
  updates?: Array<Record<string, unknown>>;
  ssp_media_slots?: SspMediaDemandSlot[];
  period_preset?: "current_week" | "last_week" | "last_7_days" | "last_14_days" | "custom";
  period_week_start?: string;
  period_week_end?: string;
};

export async function postAction(
  ctx: RuntimeContext,
  payload: ActionPayload,
): Promise<RuntimeEnvelope<Record<string, unknown>>> {
  const resp = await fetch(buildApiUrl("/api/action"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...ctx, ...payload }),
  });
  return parseEnvelope<Record<string, unknown>>(resp);
}
