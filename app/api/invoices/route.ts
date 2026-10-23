import { z } from "zod";
import {
  invoiceAccess,
  invoiceError,
  checkInvoiceOrigin,
} from "@/lib/invoice-api";
import { createInvoice, listInvoices } from "@/lib/data/invoices";
import { invoiceDocumentSchema } from "@/lib/invoices";

export async function GET(request: Request) {
  const access = await invoiceAccess();
  if (access.response) return access.response;
  const url = new URL(request.url);
  const companyId = url.searchParams.get("companyId") || undefined;
  if (companyId && !z.uuid().safeParse(companyId).success)
    return Response.json({ error: "Invalid customer." }, { status: 400 });
  const page = z.coerce
    .number()
    .int()
    .min(0)
    .max(100000)
    .safeParse(url.searchParams.get("page") ?? 0);
  if (!page.success)
    return Response.json({ error: "Invalid page." }, { status: 400 });
  try {
    return Response.json(
      await listInvoices(
        page.data,
        (url.searchParams.get("search") ?? "").slice(0, 200),
        url.searchParams.get("status") ?? "",
        companyId,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return invoiceError(error);
  }
}

export async function POST(request: Request) {
  const originError = checkInvoiceOrigin(request);
  if (originError) return originError;
  const access = await invoiceAccess("draft");
  if (access.response) return access.response;
  const parsed = invoiceDocumentSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  try {
    return Response.json(
      { invoice: await createInvoice(parsed.data, access.viewer.id) },
      { status: 201 },
    );
  } catch (error) {
    return invoiceError(error);
  }
}
