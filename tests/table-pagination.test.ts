import assert from "node:assert/strict";
import test from "node:test";
import { tablePaginationState } from "../lib/table-pagination.ts";

test("empty lists have no previous/next actions even after a filter removes every row", () => {
  assert.deepEqual(tablePaginationState(5, 0, 0, 101, 0), { page: 1, pages: 1, total: 0, start: 0, end: 0, hasRange: true, canPrevious: false, canNext: false });
});

test("pagination clamps a stale page and preserves the last page's real row range", () => {
  const state = tablePaginationState(8, 3, 53, 51, 75);
  assert.equal(state.page, 3);
  assert.equal(state.start, 51);
  assert.equal(state.end, 53);
  assert.equal(state.canNext, false);
  assert.equal(state.canPrevious, true);
});

test("malformed pagination never enables navigation outside the available data", () => {
  const empty = tablePaginationState(NaN, Infinity, -5);
  assert.equal(empty.page, 1);
  assert.equal(empty.pages, 1);
  assert.equal(empty.canPrevious, false);
  assert.equal(empty.canNext, false);
  const first = tablePaginationState(-1, 2, 30);
  assert.equal(first.page, 1);
  assert.equal(first.canPrevious, false);
  assert.equal(first.canNext, true);
});
