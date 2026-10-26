import assert from "node:assert/strict";
import test from "node:test";
import { companyCatalogPdfFilename, companyCatalogPdfUrl, renderCompanyCatalogPdf } from "../lib/company-catalog-pdf.ts";
import { getOrCreateCatalogPdf } from "../lib/catalog-pdf-storage.ts";
import { b2bProducts } from "../lib/data/b2b-products.ts";

const catalog = { id: "catalog-1", company: "Acme / Works", version: 2, currency: "EUR", priceDate: "2026-10-26", productSkus: [b2bProducts[0].sku], pdfUrl: null, createdAt: "2026-10-26" };

test("company PDF uses the exact saved selection, version, customer and price date", () => {
  const pdf = new TextDecoder().decode(renderCompanyCatalogPdf(catalog, b2bProducts));
  assert.match(pdf, /Acme \/ Works/);
  assert.match(pdf, /Company catalog v2/);
  assert.match(pdf, /EUR/);
  assert.match(pdf, /2026-10-26  \|  1 products/);
  assert.ok(pdf.includes(b2bProducts[0].name));
  assert.match(pdf, /no currency conversion applied/);
  assert.equal(companyCatalogPdfFilename(catalog), "filazoo-Acme-Works-catalog-v2.pdf");
  assert.equal(companyCatalogPdfUrl("a/b", true), "/api/catalogs/a%2Fb/pdf?download=1");
});

test("missing products fail explicitly, while an empty catalog produces a valid PDF", () => {
  assert.throws(() => renderCompanyCatalogPdf(catalog, []), /unavailable/);
  assert.match(new TextDecoder().decode(renderCompanyCatalogPdf({ ...catalog, productSkus: [] }, [])), /No products selected/);
});

function fakeStorage(options: { saved?: Uint8Array; outage?: boolean; uploadFails?: boolean; winner?: Uint8Array } = {}) {
  let saved = options.saved;
  let renders = 0;
  let uploads = 0;
  const missing = { data: null, error: { statusCode: "400", message: "Object not found" } };
  const storage = {
    from: () => ({
      download: async () => options.outage ? { data: null, error: { statusCode: "503" } } : saved ? { data: new Blob([saved]), error: null } : missing,
      upload: async (_path: string, bytes: Uint8Array, config: { upsert: boolean }) => {
        uploads++;
        assert.equal(config.upsert, false);
        if (options.uploadFails) { saved = options.winner; return { error: { message: "Upload failed" } }; }
        saved = bytes;
        return { error: null };
      },
    }),
    createBucket: async (_name: string, config: { public: boolean }) => {
      assert.equal(config.public, false);
      return { error: null };
    },
  } as unknown as Parameters<typeof getOrCreateCatalogPdf>[0];
  return { storage, render: async () => { renders++; return new Uint8Array([1, 2, 3]); }, counts: () => ({ renders, uploads }) };
}

test("existing version is returned without regenerating or overwriting its prices", async () => {
  const fake = fakeStorage({ saved: new Uint8Array([9]) });
  assert.deepEqual(await getOrCreateCatalogPdf(fake.storage, "a/v1.pdf", fake.render), new Uint8Array([9]));
  assert.deepEqual(fake.counts(), { renders: 0, uploads: 0 });
});

test("missing versions generate and save once, then reuse identical bytes", async () => {
  const fake = fakeStorage();
  const first = await getOrCreateCatalogPdf(fake.storage, "a/v1.pdf", fake.render);
  assert.deepEqual(await getOrCreateCatalogPdf(fake.storage, "a/v1.pdf", fake.render), first);
  assert.deepEqual(fake.counts(), { renders: 1, uploads: 1 });
});

test("concurrent generation returns the saved winner rather than a second version", async () => {
  const fake = fakeStorage({ uploadFails: true, winner: new Uint8Array([8]) });
  assert.deepEqual(await getOrCreateCatalogPdf(fake.storage, "a/v1.pdf", fake.render), new Uint8Array([8]));
});

test("storage outages and failed uploads are surfaced for retry", async () => {
  const outage = fakeStorage({ outage: true });
  await assert.rejects(getOrCreateCatalogPdf(outage.storage, "a/v1.pdf", outage.render), /Unable to read/);
  assert.deepEqual(outage.counts(), { renders: 0, uploads: 0 });
  const failed = fakeStorage({ uploadFails: true });
  await assert.rejects(getOrCreateCatalogPdf(failed.storage, "a/v1.pdf", failed.render), /Unable to save/);
});
