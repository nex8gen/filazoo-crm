import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import nextConfig from "../next.config.ts";

const require = createRequire(import.meta.url);
const { unstable_getResponseFromNextConfig } = require("next/experimental/testing/server") as {
  unstable_getResponseFromNextConfig: (input: { url: string; nextConfig: typeof nextConfig }) => Promise<Response>;
};

test("old page URLs redirect directly to named pages and retain their query parameters", async () => {
  const examples = [
    ["/", "/analytics"],
    ["/lead-channel/ai-agent?flow=selected", "/workflow?flow=selected"],
    ["/lead-channel/ai-agent/qa", "/workflow/qa"],
    ["/automation?flow=selected", "/workflow?flow=selected"],
    ["/catalogs", "/products"],
    ["/catalogs/products/PLA%20Black", "/products/PLA%20Black"],
    ["/catalogs/companies?company=selected", "/company-quotations?company=selected"],
    ["/catalogs/companies/selected", "/company-quotations/selected"],
    ["/emails?mailbox=team&thread=selected", "/email?mailbox=team&thread=selected"],
    ["/emails/flows?scope=company&companyId=selected", "/email/workflows?scope=company&companyId=selected"],
  ];
  for (const [from, to] of examples) {
    const response = await unstable_getResponseFromNextConfig({ url: `https://crm.example${from}`, nextConfig });
    assert.equal(response.status, 308, from);
    assert.equal(response.headers.get("location"), `https://crm.example${to}`, from);
    const canonical = await unstable_getResponseFromNextConfig({ url: `https://crm.example${to}`, nextConfig });
    assert.equal(canonical.status, 200, `Redirect loop at ${to}`);
  }
});

test("canonical pages and loading boundaries exist at the destinations", () => {
  for (const route of ["analytics", "workflow", "workflow/qa", "products", "products/[sku]", "company-quotations", "company-quotations/[id]", "email", "email/workflows"]) {
    for (const file of ["page.tsx", "loading.tsx"]) {
      assert.ok(existsSync(new URL(`../app/${route}/${file}`, import.meta.url)), `${route}/${file}`);
    }
  }
});

test("page renames leave API and other workspace routes untouched", async () => {
  for (const route of ["/api/catalogs/selected/pdf", "/api/email/flows", "/api/flows", "/companies", "/settings/apps", "/messenger"]) {
    const response = await unstable_getResponseFromNextConfig({ url: `https://crm.example${route}`, nextConfig });
    assert.equal(response.status, 200, route);
    assert.equal(response.headers.get("location"), null, route);
  }
});
