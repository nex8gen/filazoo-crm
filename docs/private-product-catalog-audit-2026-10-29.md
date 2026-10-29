Products open at `/catalogs/products/[sku]` with a complete page editor. The shared synchronized SKU remains stable; each user's names, prices, currency, variants, availability notes and photos are saved in `user_product_overrides`. All workspace roles can edit their own copy, including viewers. Base-price edits update variants that inherited the previous base price while preserving separately priced variants. Forms reject invalid prices, duplicate variants and stale saves.

Product photo uploads use a private bucket and an authenticated owner-only image endpoint. Imported local and existing HTTPS photos remain supported. The editor now submits its variant/color metadata correctly instead of failing the previous required-colors validation.

Manual exports, agent product lookups, agent catalog attachments, flow AI replies, flow catalog templates, flow previews and delivery tests, and conversation AI catalogs use the current user's effective product records. Workers carry the saved automation owner's user ID explicitly. Catalog lists, agent PDF actions, customer catalog history and PDF endpoints reject another user's catalog, including requests made by administrators. Signed-out PDF requests return 401 instead of login HTML.

New saved catalogs capture immutable product snapshots and allocate version numbers independently per owner and customer. Subsequent price or photo edits require a new catalog version; old PDF bytes remain unchanged. Legacy catalogs are attributed to their recorded creator where audit evidence exists. Unattributed legacy rows are not exposed by the updated application. Browser-role database grants are revoked and RLS remains enabled, matching the application's server-only data model.

Validation completed:

- `npm run verify`: ESLint, all 780 tests, production build, and client bundle budgets passed.
- `tests/private-products-database.sql` passed against the linked database with every test mutation rolled back. It checks private grants, RLS, private storage, per-owner version allocation, immutable prices and ownership, and trigger permissions.
- Real two-account integration checks saved independent ABS edits, rejected stale saves, uploaded a synthetic private photo, rejected cross-account photo/PDF access, generated separate full flow catalogs, preserved catalog PDF snapshots after later edits, and confirmed the shared ABS baseline was unchanged.
- Authenticated HTTP checks passed against the local production build: owner PDF/photo access, cross-account 404, anonymous 401, and personalized product page rendering.
- A viewer-role account saved EUR 12.34 / 9.50 / 8.50 pricing and an independent EUR 15.55 variant through the production-build browser UI. The second account retained its USD 9.00 price. The browser downloaded a real catalog, and text extraction plus PNG inspection confirmed those exact prices, the private photo, and the original variant photos.
- Browser file selection could not complete because the Chrome extension disallows file URL access. Signed upload creation, actual upload bytes, persistence and authenticated photo retrieval passed through the real API and storage checks. Browser permissions were not changed.
- No customer emails were sent and no customer automation was enabled.

Migration `supabase/migrations/20261029035043_private_product_catalogs.sql` is applied to the linked project. The application changes are verified locally and still need deployment. The strict database guard rejects old application writers that omit catalog ownership; deploying the updated application is required for catalog creation. An attempted temporary ownerless-insert compatibility exception was rejected by automatic approval review and was removed rather than weakening privacy.

Repeatable checks: `tests/private-products.test.ts`, `tests/product-edit-metadata.test.ts`, the agent/flow catalog suites, and `scripts/verify-private-products.mjs`. The integration script uses disposable test users and supports `--retain`, `--http-only`, `--origin`, and `--cleanup`. If the Auth service refuses test-user deletion, it writes a narrowly scoped SQL cleanup for execution through the database connector.
