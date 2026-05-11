import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";

function loadRestorePersistedState(): {
  FRONTEND_SESSION_KEY: string;
  restorePersistedState: () => { ctx: { env: string; manifest: string; artifact_root: string } };
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
  const sandbox = {
    exports: runtime.exports,
    module: runtime,
    URLSearchParams,
    Date,
    JSON,
    window: undefined as unknown,
    sessionStorage: undefined as unknown,
  };
  const script = new Script(transpiled);
  script.runInNewContext(sandbox);

  const restore = runtime.exports.restorePersistedState;
  const key = runtime.exports.FRONTEND_SESSION_KEY;
  assert.equal(typeof restore, "function", "restorePersistedState 載入失敗");
  assert.equal(typeof key, "string", "FRONTEND_SESSION_KEY 載入失敗");

  return {
    FRONTEND_SESSION_KEY: key as string,
    restorePersistedState: restore as () => { ctx: { env: string; manifest: string; artifact_root: string } },
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
