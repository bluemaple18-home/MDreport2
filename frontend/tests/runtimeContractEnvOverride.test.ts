import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";

function loadRestorePersistedState(): {
  FRONTEND_SESSION_KEY: string;
  restorePersistedState: () => {
    ctx: { env: string; manifest: string; artifact_root: string };
    period: { preset: string; weekStart: string; weekEnd: string; label: string };
    dspRawdataFilters: { dateBucket: string; distributor: string; adFormat: string; size: string; template: string };
  };
  updatePeriodPreset: (
    current: { preset: string; weekStart: string; weekEnd: string; label: string },
    preset: string,
  ) => { preset: string; weekStart: string; weekEnd: string; label: string };
  resolvePeriodForMainTab: (
    mainTab: string,
    current: { preset: string; weekStart: string; weekEnd: string; label: string },
  ) => { preset: string; weekStart: string; weekEnd: string; label: string };
  shouldRefreshFrameForRoute: (route: { mainTab: string }) => boolean;
  resolveTab4DeliveryReadiness: (
    delivery: {
      ready?: boolean;
      reason?: string;
      delivery_snapshot_token?: string;
      last_delivery_run_id?: string;
      delivery_week_start?: string;
      delivery_week_end?: string;
    },
    period: { weekStart: string; weekEnd: string },
  ) => { ready: boolean; reason: string; snapshotToken: string; deliveryRunId: string };
  sandbox: { window: unknown; sessionStorage: unknown };
} {
  const sourcePath = join(process.cwd(), "src/state/runtimeContract.ts");
  const source = readFileSync(sourcePath, "utf8");
  const transpileInput = source
    .replace(/import type[\s\S]*?from "\.\.\/types";\n/, "")
    .replace(
      'import { defaultDspRawdataFilters } from "../shell/dspRawdataFilters";\n',
      "const defaultDspRawdataFilters = { dateBucket: \"last_week\", distributor: \"\", adFormat: \"\", size: \"\", template: \"\" };\n",
    );
  const transpiled = ts.transpileModule(transpileInput, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const runtime = { exports: {} as Record<string, unknown> };
  const FixedDate = class extends Date {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super("2026-05-12T12:00:00");
        return;
      }
      super(...(args as []));
    }

    static now(): number {
      return new Date("2026-05-12T12:00:00").getTime();
    }
  };
  const sandbox = {
    exports: runtime.exports,
    module: runtime,
    URLSearchParams,
    Date: FixedDate,
    JSON,
    window: undefined as unknown,
    sessionStorage: undefined as unknown,
  };
  const script = new Script(transpiled);
  script.runInNewContext(sandbox);

  const restore = runtime.exports.restorePersistedState;
  const updatePeriodPreset = runtime.exports.updatePeriodPreset;
  const resolvePeriodForMainTab = runtime.exports.resolvePeriodForMainTab;
  const shouldRefreshFrameForRoute = runtime.exports.shouldRefreshFrameForRoute;
  const resolveTab4DeliveryReadiness = runtime.exports.resolveTab4DeliveryReadiness;
  const key = runtime.exports.FRONTEND_SESSION_KEY;
  assert.equal(typeof restore, "function", "restorePersistedState 載入失敗");
  assert.equal(typeof updatePeriodPreset, "function", "updatePeriodPreset 載入失敗");
  assert.equal(typeof resolvePeriodForMainTab, "function", "resolvePeriodForMainTab 載入失敗");
  assert.equal(typeof shouldRefreshFrameForRoute, "function", "shouldRefreshFrameForRoute 載入失敗");
  assert.equal(typeof resolveTab4DeliveryReadiness, "function", "resolveTab4DeliveryReadiness 載入失敗");
  assert.equal(typeof key, "string", "FRONTEND_SESSION_KEY 載入失敗");

  return {
    FRONTEND_SESSION_KEY: key as string,
    restorePersistedState: restore as () => {
      ctx: { env: string; manifest: string; artifact_root: string };
      period: { preset: string; weekStart: string; weekEnd: string; label: string };
      dspRawdataFilters: { dateBucket: string; distributor: string; adFormat: string; size: string; template: string };
    },
    updatePeriodPreset: updatePeriodPreset as (
      current: { preset: string; weekStart: string; weekEnd: string; label: string },
      preset: string,
    ) => { preset: string; weekStart: string; weekEnd: string; label: string },
    resolvePeriodForMainTab: resolvePeriodForMainTab as (
      mainTab: string,
      current: { preset: string; weekStart: string; weekEnd: string; label: string },
    ) => { preset: string; weekStart: string; weekEnd: string; label: string },
    shouldRefreshFrameForRoute: shouldRefreshFrameForRoute as (route: { mainTab: string }) => boolean,
    resolveTab4DeliveryReadiness: resolveTab4DeliveryReadiness as (
      delivery: {
        ready?: boolean;
        reason?: string;
        delivery_snapshot_token?: string;
        last_delivery_run_id?: string;
        delivery_week_start?: string;
        delivery_week_end?: string;
      },
      period: { weekStart: string; weekEnd: string },
    ) => { ready: boolean; reason: string; snapshotToken: string; deliveryRunId: string },
    sandbox,
  };
}

const runtime = loadRestorePersistedState();

function installRuntimeGlobals(search: string): void {
  const store = new Map<string, string>();
  const sessionStorageMock = {
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
  };

  runtime.sandbox.sessionStorage = sessionStorageMock;
  runtime.sandbox.window = {
    location: { search, pathname: "/" },
    history: { replaceState: () => {} },
  };
}

function seedSessionContext(ctx: { env: string; manifest: string; artifact_root: string }): void {
  const storage = runtime.sandbox.sessionStorage as { setItem: (key: string, value: string) => void };
  storage.setItem(runtime.FRONTEND_SESSION_KEY, JSON.stringify({ ctx }));
}

function seedSessionState(state: Record<string, unknown>): void {
  const storage = runtime.sandbox.sessionStorage as { setItem: (key: string, value: string) => void };
  storage.setItem(runtime.FRONTEND_SESSION_KEY, JSON.stringify(state));
}

test("query env=test without manifest/artifact_root uses test defaults instead of session prod", () => {
  installRuntimeGlobals("?env=test");
  seedSessionContext({
    env: "prod",
    manifest: "bootstrap.manifest.json",
    artifact_root: "artifacts",
  });

  const restored = runtime.restorePersistedState();
  assert.equal(restored.ctx.env, "test");
  assert.equal(restored.ctx.manifest, "bootstrap.test.manifest.json");
  assert.equal(restored.ctx.artifact_root, "artifacts_test");
});

test("query env=prod without manifest/artifact_root uses prod defaults instead of session test", () => {
  installRuntimeGlobals("?env=prod");
  seedSessionContext({
    env: "test",
    manifest: "bootstrap.test.manifest.json",
    artifact_root: "artifacts_test",
  });

  const restored = runtime.restorePersistedState();
  assert.equal(restored.ctx.env, "prod");
  assert.equal(restored.ctx.manifest, "bootstrap.manifest.json");
  assert.equal(restored.ctx.artifact_root, "artifacts");
});

test("explicit query manifest/artifact_root still has top priority", () => {
  installRuntimeGlobals("?env=test&manifest=custom.manifest.json&artifact_root=custom_artifacts");
  seedSessionContext({
    env: "prod",
    manifest: "bootstrap.manifest.json",
    artifact_root: "artifacts",
  });

  const restored = runtime.restorePersistedState();
  assert.equal(restored.ctx.env, "test");
  assert.equal(restored.ctx.manifest, "custom.manifest.json");
  assert.equal(restored.ctx.artifact_root, "custom_artifacts");
});

test("dsp preset two_weeks_ago resolves to the previous full Monday-Sunday window", () => {
  const restored = runtime.updatePeriodPreset(
    { preset: "last_week", weekStart: "2026-05-04", weekEnd: "2026-05-10", label: "2026-05-04 ~ 2026-05-10" },
    "two_weeks_ago",
  );

  assert.equal(restored.preset, "two_weeks_ago");
  assert.equal(restored.weekStart, "2026-04-27");
  assert.equal(restored.weekEnd, "2026-05-03");
  assert.equal(restored.label, "2026-04-27 ~ 2026-05-03");
});

test("query dsp period keeps rawdata date filter on the selected week", () => {
  installRuntimeGlobals(
    "?workflow=dsp&main_tab=dsp_tab3&sub_tab=rawdata&period_preset=two_weeks_ago&period_week_start=2026-04-27&period_week_end=2026-05-03",
  );
  seedSessionState({
    route: { workflow: "dsp", mainTab: "dsp_tab3", subTab: "rawdata" },
    period: { preset: "last_week", weekStart: "2026-05-04", weekEnd: "2026-05-10", label: "2026-05-04 ~ 2026-05-10" },
    dspRawdataFilters: { dateBucket: "last_week", distributor: "", adFormat: "", size: "", template: "" },
  });

  const restored = runtime.restorePersistedState();
  assert.equal(restored.period.preset, "two_weeks_ago");
  assert.equal(restored.dspRawdataFilters.dateBucket, "two_weeks_ago");
});

test("ssp current_month ignores stale query window and resolves through yesterday", () => {
  installRuntimeGlobals(
    "?workflow=ssp&main_tab=ssp_anomaly&period_preset=current_month&period_week_start=2026-05-01&period_week_end=2026-05-10",
  );

  const restored = runtime.restorePersistedState();
  assert.equal(restored.period.preset, "current_month");
  assert.equal(restored.period.weekStart, "2026-05-01");
  assert.equal(restored.period.weekEnd, "2026-05-11");
});

test("custom period keeps explicit query window", () => {
  installRuntimeGlobals(
    "?workflow=ssp&main_tab=ssp_anomaly&period_preset=custom&period_week_start=2026-05-03&period_week_end=2026-05-10",
  );

  const restored = runtime.restorePersistedState();
  assert.equal(restored.period.preset, "custom");
  assert.equal(restored.period.weekStart, "2026-05-03");
  assert.equal(restored.period.weekEnd, "2026-05-10");
});

test("ssp legacy last_7_days query is coerced to last_14_days", () => {
  installRuntimeGlobals(
    "?workflow=ssp&main_tab=ssp_anomaly&period_preset=last_7_days&period_week_start=2026-05-05&period_week_end=2026-05-11",
  );

  const restored = runtime.restorePersistedState();
  assert.equal(restored.period.preset, "last_14_days");
  assert.equal(restored.period.weekStart, "2026-04-28");
  assert.equal(restored.period.weekEnd, "2026-05-11");
});

test("legacy last_7_days preset action is coerced to last_14_days", () => {
  const restored = runtime.updatePeriodPreset(
    { preset: "current_month", weekStart: "2026-05-01", weekEnd: "2026-05-11", label: "2026-05-01 ~ 2026-05-11" },
    "last_7_days",
  );

  assert.equal(restored.preset, "last_14_days");
  assert.equal(restored.weekStart, "2026-04-28");
  assert.equal(restored.weekEnd, "2026-05-11");
});

test("main tab period policy resets SSP anomaly to current month", () => {
  const restored = runtime.resolvePeriodForMainTab(
    "ssp_anomaly",
    { preset: "last_14_days", weekStart: "2026-04-28", weekEnd: "2026-05-11", label: "2026-04-28 ~ 2026-05-11" },
  );

  assert.equal(restored.preset, "current_month");
  assert.equal(restored.weekStart, "2026-05-01");
  assert.equal(restored.weekEnd, "2026-05-11");
});

test("main tab period policy keeps non-overridden SSP tabs unchanged", () => {
  const restored = runtime.resolvePeriodForMainTab(
    "ssp_media_demand",
    { preset: "last_14_days", weekStart: "2026-04-28", weekEnd: "2026-05-11", label: "2026-04-28 ~ 2026-05-11" },
  );

  assert.equal(restored.preset, "last_14_days");
  assert.equal(restored.weekStart, "2026-04-28");
  assert.equal(restored.weekEnd, "2026-05-11");
});

test("route frame refresh policy is centralized by main tab", () => {
  assert.equal(runtime.shouldRefreshFrameForRoute({ mainTab: "ssp_anomaly" }), true);
  assert.equal(runtime.shouldRefreshFrameForRoute({ mainTab: "ssp_media_demand" }), true);
  assert.equal(runtime.shouldRefreshFrameForRoute({ mainTab: "ssp_ad_group" }), true);
  assert.equal(runtime.shouldRefreshFrameForRoute({ mainTab: "dsp_tab4" }), true);
  assert.equal(runtime.shouldRefreshFrameForRoute({ mainTab: "dsp_tab3" }), false);
});

test("monthly workflow defaults to previous full month", () => {
  installRuntimeGlobals("?workflow=monthly&main_tab=monthly_p4");

  const restored = runtime.restorePersistedState();
  assert.equal(restored.period.preset, "custom");
  assert.equal(restored.period.weekStart, "2026-04-01");
  assert.equal(restored.period.weekEnd, "2026-04-30");
});

test("tab4 delivery readiness locks export when delivery period differs from current period", () => {
  const readiness = runtime.resolveTab4DeliveryReadiness(
    {
      ready: true,
      reason: "",
      delivery_snapshot_token: "token-a",
      last_delivery_run_id: "run-a",
      delivery_week_start: "2026-04-27",
      delivery_week_end: "2026-05-03",
    },
    { weekStart: "2026-05-04", weekEnd: "2026-05-10" },
  );

  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, "period_mismatch");
  assert.equal(readiness.snapshotToken, "token-a");
  assert.equal(readiness.deliveryRunId, "run-a");
});
