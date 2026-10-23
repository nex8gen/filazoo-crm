import type { Invoice } from "./invoices.ts";

export function canReadInvoices(role: string) {
  return ["admin", "operator", "bd_manager", "viewer"].includes(role);
}

export function canCreateInvoices(role: string) {
  return ["admin", "operator", "bd_manager"].includes(role);
}

export function canManageBilling(role: string) {
  return ["admin", "operator"].includes(role);
}

export function canEditInvoice(viewer: { id: string; role: string }, invoice: Pick<Invoice, "status" | "created_by">) {
  return invoice.status === "draft" && (canManageBilling(viewer.role) || (viewer.role === "bd_manager" && invoice.created_by === viewer.id));
}

export function canMutateInvoice(viewer: { id: string; role: string }, invoice: Pick<Invoice, "status" | "created_by">, action: string) {
  return canManageBilling(viewer.role) || (action === "save" && canEditInvoice(viewer, invoice));
}
