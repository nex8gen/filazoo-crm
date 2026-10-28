# Catalog generation

All catalog creators use the quotation template implemented in `lib/catalog-pdf.ts`: ten color images per row, material bands, alternating product cells, pink/yellow/blue price columns, and the centered black Filazoo logo and catalog title. Quantity labels come from each product's saved pricing ranges.

- Server agents, flow attachments, and email auto-replies call `buildServerCatalogPdf` from `lib/catalog-pdf-server.ts`. This awaits image loading before rendering the shared template.
- Saved company catalogs call `ensureCompanyCatalogPdf`. It uses the same image loader and template and preserves the bytes of previously saved quote versions.
- A new automated catalog request creates a fresh company-catalog version. If no products were specified, it preserves the customer's saved product selection instead of reattaching an old-layout PDF.
- Browser previews, downloads, and email composition call `buildCatalogPdfWithImages` or `downloadCatalogPdf` from `lib/catalog-pdf.ts`.

Do not call the synchronous `buildCatalogPdf` directly from an agent or email worker: it requires an already populated image map. Do not generate alternate layouts or attach the old static download for new catalogs.

Images remain keyed by their original product/variant URLs. Each cell prefers its own variant photo, then the product photo, then the default image. Photos retain their aspect ratios and stay inside their cells above their color captions. Only quotation imports receive the source-border crop. Remote server loads remain limited to the configured storage host and Shopify CDN.

Validate catalog changes with `tests/catalog-pdf.test.ts`, `tests/catalog-pdf-server.test.ts`, `tests/company-catalog-pdf.test.ts`, `tests/flow-ai-options.test.ts`, and `tests/email-auto-reply.test.ts`. Render and inspect a PDF containing multiple products and variant photos before changing the shared layout.
