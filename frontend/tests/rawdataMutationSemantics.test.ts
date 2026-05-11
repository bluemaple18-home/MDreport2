import assert from "node:assert/strict";
import test from "node:test";
import { resolvePostMutationLocalState } from "../src/shell/rawdataMutationSemantics.ts";

test("modify/save failure keeps local edits", () => {
  const rawEdits = {
    "1::最終經銷商": "A2",
    "2::最終廣告形式": "Native",
  };
  const revertedRows = {
    "3": true,
  };
  const out = resolvePostMutationLocalState(false, rawEdits, revertedRows);
  assert.equal(out.cleared, false);
  assert.equal(out.rawEdits, rawEdits);
  assert.equal(out.revertedRows, revertedRows);
  assert.equal(out.rawEdits["1::最終經銷商"], "A2");
});

test("modify/save success clears local edits", () => {
  const rawEdits = {
    "1::最終經銷商": "A2",
  };
  const revertedRows = {
    "9": true,
  };
  const out = resolvePostMutationLocalState(true, rawEdits, revertedRows);
  assert.equal(out.cleared, true);
  assert.deepEqual(out.rawEdits, {});
  assert.deepEqual(out.revertedRows, {});
});
