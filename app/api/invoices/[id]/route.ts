import { z } from "zod";
import {
  invoiceAccess,
  invoiceError,
  checkInvoiceOrigin,
} from "@/lib/invoice-api";
import { getInvoice, mutateInvoice } from "@/lib/data/invoices";
import { invoiceMutationSchema, invoiceTotals } from "@/lib/invoices";
import { canMutateInvoice } from "@/lib/invoice-permissions";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  const access = await invoiceAccess();
  if (access.response) return access.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success)
    return Response.json({ error: "Invalid invoice ID." }, { status: 400 });
  try {
    const invoice = await getInvoice(id);
    return invoice
      ? Response.json({ invoice }, { headers: { "Cache-Control": "no-store" } })
      : Response.json({ error: "Invoice not found." }, { status: 404 });
  } catch (error) {
    return invoiceError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  const originError = checkInvoiceOrigin(request);
  if (originError) return originError;
  const access = await invoiceAccess("draft");
  if (access.response) return access.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success)
    return Response.json({ error: "Invalid invoice ID." }, { status: 400 });
  const parsed = invoiceMutationSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  const input = parsed.data;
  try {
    const existing = await getInvoice(id);
    if (!existing) return Response.json({ error: "Invoice not found." }, { status: 404 });
    if (!canMutateInvoice(access.viewer, existing, input.action))
      return Response.json({ error: "BD managers can only edit draft invoices they created. Issuing invoices and managing payments require an admin or operator." }, { status: 403 });
    const invoice = await mutateInvoice(
      id,
      access.viewer.id,
      input.action === "save"
        ? { ...input, totalMinor: invoiceTotals(input.document).total }
        : input,
    );
    return Response.json({ invoice });
  } catch (error) {
    return invoiceError(error);
  }
}
