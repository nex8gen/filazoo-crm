import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceMemory } from "../lib/workspace-memory.ts";

test("view memory retains more than three pages and restores falsy controls", () => {
  const memory = createWorkspaceMemory();
  for (let page = 0; page < 20; page++) memory.write(`page-${page}`, { query: `search ${page}`, page });
  assert.deepEqual(memory.read("page-0", null), { query: "search 0", page: 0 });
  for (const value of [0, false, "", null, undefined]) {
    memory.write("control", value);
    assert.equal(memory.read("control", "fallback"), value);
  }
});

test("account providers have isolated memory and do not carry drafts into a new account", () => {
  const firstAccount = createWorkspaceMemory();
  firstAccount.write("settings.profile.name", "Unsaved profile draft");
  const secondAccount = createWorkspaceMemory();
  assert.equal(secondAccount.read("settings.profile.name", null), null);
  assert.equal(firstAccount.read("settings.profile.name", null), "Unsaved profile draft");
});

test("only subscribed views are notified, equal values do no work and unmounted pages retain values", () => {
  const memory = createWorkspaceMemory();
  let calls = 0;
  const unsubscribe = memory.subscribe("companies.query", () => calls++);
  memory.write("products.query", "PLA");
  assert.equal(calls, 0);
  memory.write("companies.query", "Acme");
  memory.write("companies.query", "Acme");
  assert.equal(calls, 1);
  unsubscribe();
  memory.write("companies.query", "Buyer");
  assert.equal(calls, 1);
  assert.equal(memory.read("companies.query", ""), "Buyer");
});

test("memory stays bounded and editing a view renews its retention", () => {
  const memory = createWorkspaceMemory(3);
  memory.write("old", 1); memory.write("edited", 2); memory.write("third", 3);
  memory.write("edited", 4); memory.write("fourth", 5);
  assert.equal(memory.read("old", null), null);
  assert.equal(memory.read("edited", null), 4);
});

test("memory pressure evicts invoice rows, filters and page number as one view", () => {
  const memory = createWorkspaceMemory(3);
  memory.write("invoices.all.listing", { invoices: [{ id: "page-two-row" }] });
  memory.write("invoices.all.page", 2);
  memory.write("invoices.all.filters", { search: "Buyer" });
  memory.write("companies.query", "Acme");
  assert.equal(memory.read("invoices.all.listing", null), null);
  assert.equal(memory.read("invoices.all.page", 0), 0);
  assert.equal(memory.read("invoices.all.filters", null), null);
  assert.equal(memory.read("companies.query", ""), "Acme");
});
