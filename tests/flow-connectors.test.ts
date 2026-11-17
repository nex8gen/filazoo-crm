import assert from "node:assert/strict";
import test from "node:test";
import { flowConnectorPath } from "../lib/flow-connectors.ts";

test("straight connectors keep the exact card attachment points", () => {
  assert.equal(flowConnectorPath({ x: 170, y: 68 }, { x: 170, y: 124 }), "M 170 68 L 170 124");
  assert.equal(flowConnectorPath({ x: 0, y: 0 }, { x: 0, y: 0 }), "M 0 0 L 0 0");
});

test("rounded split and join curves stay within their reserved gap", () => {
  for (const x of [-1600, -194, -1, 1, 194, 1600]) for (const y of [-56, -2, 2, 56]) {
    const path = flowConnectorPath({ x: 0, y: 0 }, { x, y });
    assert.ok(path.startsWith("M 0 0 "));
    assert.ok(path.endsWith(`L ${x} ${y}`));
    assert.equal(path.match(/Q/g)?.length, 2);
    const coordinates = path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    for (let index = 0; index < coordinates.length; index += 2) {
      assert.ok(coordinates[index] >= Math.min(0, x) && coordinates[index] <= Math.max(0, x));
      assert.ok(coordinates[index + 1] >= Math.min(0, y) && coordinates[index + 1] <= Math.max(0, y));
    }
  }
});

test("left and right branches use mirrored corner geometry", () => {
  const points = (x: number) => flowConnectorPath({ x: 0, y: 0 }, { x, y: 56 }).match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const left = points(-388), right = points(388);
  for (let index = 0; index < left.length; index++) {
    assert.equal(left[index] || 0, (index % 2 ? right[index] : -right[index]) || 0);
  }
});
