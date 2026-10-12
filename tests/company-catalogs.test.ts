import test from "node:test";
import assert from "node:assert/strict";
import { filterCompanyCatalogs } from "../lib/company-catalogs.ts";

const catalogs = [
  { id: "a", company: "Acme Works", currency: "USD", productSkus: ["PLA-01", "ABS-02"], version: 1, pdfUrl: "https://example.com/a.pdf", priceDate: "2026-01-15T00:00:00.000Z", createdAt: "2026-01-10T00:00:00.000Z" },
  { id: "b", company: "North Peak", currency: "EUR", productSkus: ["PETG-09"], version: 2, pdfUrl: null, priceDate: "2026-02-01T00:00:00.000Z", createdAt: "2026-01-27T00:00:00.000Z" },
];

test("filters company catalogs by company name, product, and currency", () => {
  assert.deepEqual(filterCompanyCatalogs(catalogs, "north", "all"), [catalogs[1]]);
  assert.deepEqual(filterCompanyCatalogs(catalogs, "ABS", "all"), [catalogs[0]]);
  assert.deepEqual(filterCompanyCatalogs(catalogs, "", "EUR"), [catalogs[1]]);
  assert.deepEqual(filterCompanyCatalogs(catalogs, "", "all"), catalogs);
});
