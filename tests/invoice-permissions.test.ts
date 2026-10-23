import assert from "node:assert/strict";
import test from "node:test";
import { canReadInvoices, canCreateInvoices, canManageBilling, canEditInvoice, canMutateInvoice } from "../lib/invoice-permissions.ts";

const manager = { id: "manager-1", role: "bd_manager" };
const own = { status: "draft" as const, created_by: manager.id };
const other = { ...own, created_by: "manager-2" };

test("BD managers can read all invoices and create invoices for AI replies", () => {
  assert.equal(canReadInvoices(manager.role), true);
  assert.equal(canCreateInvoices(manager.role), true);
  assert.equal(canManageBilling(manager.role), false);
});

test("BD managers can edit only their own draft invoices", () => {
  assert.equal(canEditInvoice(manager, own), true);
  assert.equal(canMutateInvoice(manager, own, "save"), true);
  for (const invoice of [other, { ...own, created_by: null }, { ...own, status: "issued" as const }, { ...own, status: "void" as const }]) {
    assert.equal(canEditInvoice(manager, invoice), false);
    assert.equal(canMutateInvoice(manager, invoice, "save"), false);
  }
  for (const action of ["issue", "void", "delete", "payment"]) assert.equal(canMutateInvoice(manager, own, action), false);
});

test("admin and operator billing access and viewer read access are preserved", () => {
  for (const role of ["admin", "operator"]) {
    const viewer = { id: "admin", role };
    assert.equal(canCreateInvoices(role), true);
    assert.equal(canEditInvoice(viewer, own), true);
    for (const action of ["save", "issue", "void", "delete", "payment"]) assert.equal(canMutateInvoice(viewer, other, action), true);
  }
  assert.equal(canReadInvoices("viewer"), true);
  assert.equal(canCreateInvoices("viewer"), false);
  assert.equal(canMutateInvoice({ id: manager.id, role: "viewer" }, own, "save"), false);
  assert.equal(canReadInvoices("unknown"), false);
});
