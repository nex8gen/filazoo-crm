import "server-only";
import { getWorkspaceViewer } from "./auth";

export async function invoiceAccess(write = false) {
  const viewer = await getWorkspaceViewer();
  if (!viewer)
    return {
      response: Response.json(
        { error: "Sign in with an active workspace account." },
        { status: 401 },
      ),
    };
  const roles = write ? ["admin", "operator"] : ["admin", "operator", "viewer"];
  if (!roles.includes(viewer.role))
    return {
      response: Response.json(
        { error: "Your role does not have access to billing." },
        { status: 403 },
      ),
    };
  return { viewer };
}

export function invoiceError(error: unknown) {
  const value = error as { code?: string; message?: string };
  if (value.code === "23503")
    return Response.json(
      {
        error:
          "A linked customer or contact was removed. Reload the customer details and try again.",
      },
      { status: 409 },
    );
  if (value.code === "P0001")
    return Response.json({ error: value.message }, { status: 409 });
  console.error("Invoice operation failed", error);
  const missing =
    value.code === "42P01" ||
    value.code === "PGRST205" ||
    value.code === "PGRST202";
  return Response.json(
    {
      error: missing
        ? "Invoice database setup is required. Apply the invoice_system migration."
        : "Unable to complete the invoice operation. Please retry.",
    },
    { status: 503 },
  );
}

export function checkInvoiceOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Invalid request origin." }, { status: 403 });
}
