import { timingSafeEqual } from "node:crypto";
import { syncErpInventory } from "@/lib/data/inventory";
import { LingxingError } from "@/lib/lingxing";
import { configuredErp, erpWorkerAuthorized } from "@/lib/data/erp-settings";
import { withWorkspaceContext } from "@/lib/workspace-context";
import { workspaceIdSchema } from "@/lib/workspaces";
import { forEachWorkspace } from "@/lib/data/workspace-runtime";

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  const legacyAuthorized = Boolean(secret && actual.length === expected.length && timingSafeEqual(actual, expected));
  const selected = new URL(request.url).searchParams.get("workspace");
  if (selected) {
    const parsed = workspaceIdSchema.safeParse(selected);
    if (!parsed.success) return Response.json({ ok: false }, { status: 400 });
    return withWorkspaceContext(parsed.data, () => syncWorkspace(request, legacyAuthorized));
  }
  if (legacyAuthorized) {
    const workspaces = await forEachWorkspace(() => syncWorkspace(request, true));
    return Response.json({ ok: true, workspaces: await Promise.all(workspaces.map(async result => ({ status: result.status, result: await result.json() }))) }, { headers: { "Cache-Control": "no-store" } });
  }
  return syncWorkspace(request, false);
}

async function syncWorkspace(request: Request, legacyAuthorized: boolean) {
  if (!legacyAuthorized && !await erpWorkerAuthorized(request.headers.get("authorization"))) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const headers = { "Cache-Control": "no-store" };
  try {
    if (!await configuredErp()) return Response.json({ ok: true, skipped: true, reason: "ERP not configured" }, { headers });
    return Response.json({ ok: true, ...await syncErpInventory() }, { headers });
  } catch (error) {
    console.error("Scheduled ERP stock sync failed.");
    return Response.json({ ok: false, error: error instanceof LingxingError ? error.message : "ERP stock sync failed." }, { status: 502, headers });
  }
}
