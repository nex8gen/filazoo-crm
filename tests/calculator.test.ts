import assert from "node:assert/strict";
import test from "node:test";
import { calculatorInput, initialCalculator } from "../lib/calculator.ts";

const run = (...keys: string[]) => keys.reduce(calculatorInput, initialCalculator);

test("calculator handles decimal arithmetic and chained operations", () => {
  assert.equal(run("0", ".", "1", "+", "0", ".", "2", "=").display, "0.3");
  assert.equal(run("1", "2", "×", "3", "+", "4", "=").display, "40");
  assert.equal(run("9", "−", "2", "=").display, "7");
  assert.equal(run("8", "÷", "2", "=").display, "4");
});

test("calculator supports corrections, sign and percent", () => {
  assert.equal(run("1", "2", "⌫", ".", ".", "5").display, "1.5");
  assert.equal(run("5", "±", "+", "2", "=").display, "-3");
  assert.equal(run("5", "0", "%").display, "0.5");
  assert.equal(run("8", "+", "×", "2", "=").display, "16");
  assert.deepEqual(run("8", "+", "AC"), initialCalculator);
});

test("calculator recovers from division by zero and starts fresh after equals", () => {
  assert.equal(run("1", "÷", "0", "=").display, "Error");
  assert.equal(run("1", "÷", "0", "=", "3").display, "3");
  assert.equal(run("2", "+", "3", "=", "7").display, "7");
  assert.equal(run("2", "+", "3", "=", "×", "4", "=").display, "20");
});
