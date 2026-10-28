import { timingSafeEqual } from "node:crypto";
import { syncErpInventory } from "@/lib/data/inventory";
import { LingxingError } from "@/lib/lingxing";
import { configuredErp, erpWorkerAuthorized } from "@/lib/data/erp-settings";

export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const actual = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  const legacyAuthorized = Boolean(secret && actual.length === expected.length && timingSafeEqual(actual, expected));
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
