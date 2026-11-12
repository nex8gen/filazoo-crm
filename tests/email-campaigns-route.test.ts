import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { campaignConfigSchema } from "../lib/email-campaigns.ts";
import { marketingYearSchema } from "../lib/marketing-assets.ts";

function load(options: { anonymous?: boolean; viewer?: boolean; failure?: boolean } = {}) {
  const calls: string[] = [];
  class MarketingAssetError extends Error { status = 400; }
  const service = (name: string) => { calls.push(name); if (options.failure) throw new Error("Private credentials"); };
  const deps: Record<string, unknown> = {
    zod: { z },
    "@/lib/auth": { getWorkspaceViewer: async () => options.anonymous ? null : { id: "user", role: options.viewer ? "viewer" : "operator" } },
    "@/lib/email-campaigns": { campaignConfigSchema }, "@/lib/marketing-assets": { marketingYearSchema },
    "@/lib/data/marketing-assets": { MarketingAssetError },
    "@/lib/data/email-campaigns": {
      getCampaignOptions: async () => { service("options"); return { audiences: [] }; },
      resolveCampaignAudience: async () => { service("preview"); return { recipients: Array.from({ length: 15 }, (_, i) => ({ id: i })), excluded: 2, recent: 1 }; },
      getCampaignDeliverySummary: async () => { service("delivery"); return { total: 3, sent: 2 }; },
      queueCampaign: async () => { service("queue"); return { dispatch: { recipientCount: 3 } }; },
    },
  };
  const api = {} as { GET: () => Promise<Response>; POST: (request: Request) => Promise<Response> };
  const code = ts.transpileModule(readFileSync(new URL("../app/api/email/campaigns/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports: api, require: (name: string) => deps[name], Response, URL, console });
  return { api, calls };
}
const id = "4f91cc05-0734-4478-a0bc-8741067397ae";
const request = (body: unknown, origin = "https://crm.test") => new Request("https://crm.test/api/email/campaigns", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("campaign endpoints authenticate, reject cross-site requests, and deny viewer sends", async () => {
  const anonymous = load({ anonymous: true });
  assert.equal((await anonymous.api.GET()).status, 401);
  assert.equal((await anonymous.api.POST(request({}))).status, 401);
  assert.deepEqual(anonymous.calls, []);
  const viewer = load({ viewer: true });
  assert.equal((await viewer.api.GET()).status, 200);
  assert.equal((await viewer.api.POST(request({ action: "queue", id, year: 2026, updatedAt: "2026-11-12T01:00:00Z" }))).status, 403);
  assert.equal((await viewer.api.POST(request({ action: "preview", config: {} }, "https://attacker.test"))).status, 403);
  assert.deepEqual(viewer.calls, ["options"]);
});

test("recipient previews return real totals while limiting exposed preview contacts", async () => {
  const { api, calls } = load();
  const response = await api.POST(request({ action: "preview", config: { includeSegments: ["all"] } }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.count, 15); assert.equal(body.recipients.length, 10);
  assert.equal(body.excluded, 2); assert.equal(body.recent, 1);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(calls, ["preview"]);
});

test("campaign submission validates saved revision and hides infrastructure errors", async () => {
  const { api, calls } = load();
  assert.equal((await api.POST(request({ action: "queue", id, year: 2026 }))).status, 400);
  assert.equal((await api.POST(request({ action: "queue", id, year: 2026, updatedAt: "2026-11-12T01:00:00Z" }))).status, 200);
  assert.deepEqual(calls, ["queue"]);
  const response = await load({ failure: true }).api.GET();
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /credentials/);
});
