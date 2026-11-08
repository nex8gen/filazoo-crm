# Shopify repeated enquiries — 8 November 2026

The production CRM received repeated copies of wholesale form submissions with different `form:<UUID>` IDs. Each was saved and displayed as a separate enquiry. The checked repeats already pointed at the same company/contact; they were not separate customer records. For example, 3D Near You submitted the same answers four times within 255 seconds. Hook it & book it had two identical copies 733 milliseconds apart.

The saved form mirror generates a new submission ID on every `submit` event. The importer previously checked only that ID and used a separate lookup/upsert, so repeated browser submissions bypassed deduplication and simultaneous requests could both enter processing. Changing CAPTCHA tokens and Shopify form keys explain why comparing the entire transport payload would also miss repeats. The saved records do not distinguish an intentional repeat click from CAPTCHA-driven resubmission; both are covered by this fix. All confirmed duplicates in this repair came through the form route, rather than the customer webhook route.

## Change

- `claim_shopify_lead` atomically claims a receipt under workspace-scoped advisory locks before any contact, company, assignment, event or automation work.
- Forms compare every nonempty `contact[...]` answer, trim outer whitespace, and lowercase email. Transport IDs, CAPTCHA tokens, form keys and inferred IP geography are excluded. Identical answers from the same email/store within ten minutes reuse the original receipt. Changed answers and later follow-ups are retained.
- The same delivery ID is never processed concurrently. Processed deliveries return success without repeating side effects; an active claim returns an error for retry. Failed deliveries can be retried, and processing claims older than fifteen minutes can be reclaimed.
- Customer-create webhooks also reuse a receipt for the same store/customer ID, even when delivery IDs differ.
- Historical exact repeats are linked through `duplicate_of` and omitted from the main Shopify enquiry list. Payloads, customer/contact links, receipt IDs, inbox state and explicit reply-thread origin lookup remain available.

Both new functions are security invokers. Execute access is restricted to the trusted server roles; browser roles have none. Existing workspace RLS remains effective.

## Production repair and verification

- Applied migration `20261108093951_shopify_submission_deduplication` to project `hukbmbicpdmhoxpkvljz`.
- Linked **11 exact repeats across eight customers**. The repair uses the first enquiry as the fixed start of each ten-minute window, avoiding chains that could suppress a later follow-up.
- Preserved all **147** historical receipt rows: **134** visible processed enquiries, **11** retained duplicates and **2** pre-existing failed imports. No failed imports were replayed.
- Checked every duplicate link: same workspace, store, contact, company, email and submitted content, within ten minutes. Invalid links: **0**.
- Fifteen focused unit tests passed. ESLint passed for changed TypeScript and the verification script. The isolated production snapshot passed Next route type generation and TypeScript checking; its Vercel build reached `READY`.
- Rollback-only SQL assertions passed for same-ID claims, different-ID/token claims, failed retries, processed duplicates, changed answers and later follow-ups.
- Live concurrency test: twelve simultaneous identical submissions with different IDs/tokens produced **one** claimed receipt and **eleven** blocked copies.
- Staged and live receiver tests both returned `{ "ok": true, "duplicate": true }` for an identical enquiry with a different ID. Verified no customer was created. These tests use temporary `.test` receipts with no company, contact or owner; claiming does not run email automation. All fixtures were removed, with **0** remaining.
- Post-deployment error/fatal log scan returned no matching logs. Security advisors showed no new findings. The existing unrelated workspace-invitations informational advisory is unchanged ([reference](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)).

## Release

Production baseline: commit `5476004a7561777f146997491e5aff7874c0b447`, deployment `dpl_88CgGUNYQ547BLMoSPFy54SZFRBe`.

Released deployment: [`dpl_6xduQEi9kZpLv1ZuwGLsnF7Yujbi`](https://vercel.com/nex8gens-projects/filazoo-crm/6xduQEi9kZpLv1ZuwGLsnF7Yujbi), serving [crm.filazoosupply.com](https://crm.filazoosupply.com). Created from the production commit with only `lib/shopify-leads.ts` and `lib/email-inbox.ts` application changes. Unrelated local work was excluded.

The SQL migration is additive and compatible with the previous application. To undo the historical display cleanup, clear `duplicate_of`; original rows are retained. Rolling the application back would restore the former duplicate-submission behavior.

Reproducible checks: `tests/shopify-deduplication-database.sql` (rolls back), `scripts/verify-shopify-deduplication.mjs` (cleans its receipts), and `scripts/repair-shopify-duplicate-inquiries.sql` (idempotent historical linking).

Relevant documentation: [Shopify CAPTCHA](https://shopify.dev/docs/storefronts/themes/trust-security/captcha), [webhook duplicate delivery guidance](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries), [Supabase RPC](https://supabase.com/docs/reference/javascript/rpc).
