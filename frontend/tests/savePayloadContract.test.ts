import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";

function loadNormalizeSaveRowsPayload(): (
  rows: Array<Record<string, unknown>>,
  fieldNames?: string[],
) => Array<Record<string, unknown>> {
  const sourcePath = join(process.cwd(), "src/state/useRuntimeStore.ts");
  const source = readFileSync(sourcePath, "utf8");
  const start = source.indexOf("export function normalizeSaveRowsPayload");
  const end = source.indexOf("function safeArrayLength", start);
  assert.ok(start >= 0, "normalizeSaveRowsPayload 函式不存在");
  assert.ok(end > start, "normalizeSaveRowsPayload 函式片段擷取失敗");
  const snippet = source.slice(start, end);
  const transpiled = ts.transpileModule(snippet, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const runtime = { exports: {} as Record<string, unknown> };
  const script = new Script(transpiled);
  script.runInNewContext({
    exports: runtime.exports,
    module: runtime,
    Object,
    Set,
    Array,
  });
  const fn = runtime.exports.normalizeSaveRowsPayload;
  assert.equal(typeof fn, "function", "normalizeSaveRowsPayload 載入失敗");
  return fn as (
    rows: Array<Record<string, unknown>>,
    fieldNames?: string[],
  ) => Array<Record<string, unknown>>;
}

const normalizeSaveRowsPayload = loadNormalizeSaveRowsPayload();
function toPlain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

test("save payload only keeps contract field_names", () => {
  const rows = [
    {
      row_order: 1,
      updated_at: "2026-05-11T00:00:00Z",
      最終經銷商: "A",
      最終廣告形式: "Banner",
      _debug_only: "x",
    },
    {
      row_order: 2,
      updated_at: "2026-05-11T00:00:01Z",
      最終經銷商: "B",
      最終廣告形式: "Native",
    },
  ];

  const out = normalizeSaveRowsPayload(rows, ["最終經銷商", "最終廣告形式"]);
  assert.deepEqual(toPlain(out), [
    { 最終經銷商: "A", 最終廣告形式: "Banner" },
    { 最終經銷商: "B", 最終廣告形式: "Native" },
  ]);
});

test("save payload fallback strips frame-only keys when field_names missing", () => {
  const rows = [
    {
      row_order: 1,
      updated_at: "2026-05-11T00:00:00Z",
      最終經銷商: "A",
      最終廣告形式: "Banner",
    },
  ];

  const out = normalizeSaveRowsPayload(rows);
  assert.deepEqual(toPlain(out), [
    { 最終經銷商: "A", 最終廣告形式: "Banner" },
  ]);
});
