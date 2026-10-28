# CRM performance audit — 28 October 2026

Follow-up: the [authentication optimization](authentication-performance.md) combines live session and role checks into one call, restores the AI icon morph animation, and records the later database migration and 665-test verification. The report below retains the earlier audit's measurements and release state.

The broader audit found unnecessary global JavaScript, repeated authentication and staff-photo requests, oversized company reads, repeated mailbox snapshots, and independent inventory requests running in sequence. These costs have been reduced in the working tree. The production build, lint, all 657 tests, and the new JavaScript budgets pass.

The remaining local timing variability is substantial. The finished build still had a 21.3-second company-profile navigation when its remote Auth request alone took 12.6 seconds. This audit does **not** establish that every page is consistently fast, or that the hosted application has improved: these changes have not been deployed.

## Scope and method

- Reviewed the shared shell, authentication and authorization, company list/profile/tabs/history, dashboard, segments, product/inventory reads, catalog/PDF preparation, invoice display, email account aggregation, notification polling, and their mutation/cache boundaries.
- Inspected the connected Supabase database statistics and performance advisors, plus the deployed Vercel region. No database schema, indexes, production configuration, or deployment was changed.
- Compared signed-in Chrome navigations against local `next build` / `next start` on port 3100. The workstation is in China; the database is in US East (`us-east-2`). The inspected hosted deployment runs in `iad1`, so these local network waits cannot predict hosted latency.
- Used an opt-in local fetch trace to identify request counts, endpoint durations, and errors. It records endpoint names and durations, without query strings, bodies, credentials, or headers. It is not enabled in application code.
- Browser timing is elapsed navigation time when the required page element was observed, including document streaming and automation observation overhead. It is **not** LCP, INP, or a statistically controlled load test. Samples are small and network conditions varied. Repeated navigations can benefit from warmed connections and the new display-avatar cache.
- `docs/performance-measurements.json` retains every recorded successful timed navigation from this audit, including intermediate builds and slow final results. Email was checked functionally but has no comparable timed baseline.

## Implemented changes

| Area | Change | Correctness boundary |
| --- | --- | --- |
| Shared shell | Extracted the small notification bell from the full task/AI activity module. Deferred the motion-based thinking indicator until it is needed. | Existing notification counts and thinking state remain available. Idle icon uses a reduced-motion-aware CSS animation. |
| Notification polling | Single in-flight refresh, throttled focus refreshes, queued explicit updates, and cleanup on unmount. | Explicit task updates still refresh; hidden/aborted components avoid requests. |
| Authentication | Reused the already validated viewer in `requireWorkspaceMember`. Route Handlers and Actions previously called Auth twice because React's render cache does not deduplicate those contexts. | Each operation still validates Auth and current activated membership/role. No persistent user or permission cache. |
| Company profile | Combined company, ordered contacts, and billing profile into one embedded query. | Primary-contact ordering, billing fields, errors, owner display, ID validation, and authorization are preserved. No email/history query on the profile path. |
| Company selectors/segments | Added purpose-specific selects instead of loading complete company records and staff avatars. | Complete 500-row pagination and sample-record exclusion remain. Segment labels and criteria retain their existing mapping. |
| Staff display photos | Cached display URLs by project and member, with bounded parallel reads and explicit invalidation after avatar changes/member removal. | Only display URLs are cached. Hard expiry is 3,300 seconds, below the signed URL's 3,600-second lifetime. Private storage paths stay on the server. Missing photos do not fail the containing page. |
| Email aggregation | Shared workspace drafts, replies, Shopify sources, assignment filters, and inbox-state promises across the authorized mailbox views. | Personal sent/received reads and mailbox permissions remain separate. Nothing is persistently cached across users. Personal-only views avoid workspace-source reads. |
| Products/inventory | Started independent product/inventory work together; started scoped inventory snapshots and sync-status reads together. Reused the loaded inventory state. | All stock pages, scope, stale status and error handling are retained. |
| Company catalogs | Used lightweight company options. Moved existing-PDF snapshot preparation to Next's `after` callback. | Authorization and product reads finish before the callback. Exact saved SKUs beyond the selector limit are fetched. Serialized catalog props are not mutated. On-demand PDF preparation remains available. |
| Dashboard | Loaded the date-picker calendar when opened. | Browser verified the two-month calendar, presets and comparison controls render. |
| Login errors | Distinguished rejected credentials from temporary Auth/network failure. | Prevents connectivity failures from incorrectly telling the user their password is wrong. |
| Verification | Added a production-shell JavaScript budget and included it in `npm run verify`. Filled existing missing application/inbox translations so the full suite passes. | Budget covers shell scripts only; streamed route-specific and interactive code is measured separately in the browser. |

The earlier company-tab optimization remains: only the selected server section is loaded initially; visited sections preserve drafts and hidden effects pause. This audit rechecked all seven tabs against the finished build.

## Measurements

The most repeatable result is less JavaScript loaded for the same routes. Bytes below are the sum of browser resource `encodedBodySize` for scripts observed at the measurement point; they exclude CSS, images, and response data.

| Route | Before script bytes | Final script bytes | Reduction | Before observed ready, seconds | Final observed ready, seconds |
| --- | ---: | ---: | ---: | --- | --- |
| Companies | 481,782 | 425,331 | 11.7% | 4.758, 4.679 | 10.305, 1.974, 4.540 |
| Company profile | 617,736 | 569,940 | 7.7% | 9.877, 5.100 | 21.345, 3.585, 3.912 |
| Segments | 432,673 | 376,258 | 13.0% | 5.742 | 14.471, 4.651, 1.101 |
| Products | 528,729 | 472,405 | 10.7% | 3.562 | 3.061 |
| Dashboard | 558,944 | 484,947 | 13.2% | 4.221 | 3.499 |
| Invoices | 466,429 | 412,331 | 11.6% | 5.340 | 4.939 |

Additional final smoke-check observations: Messenger 4.048s; Tasks 1.057s; Automations 3.540s; Settings 1.479s; Company catalogs 1.880s. These have no before measurement and are not claimed as speedups.

Do not use only the fastest result as a promise. Warm company-profile navigations improved, but the final sample set also contains a worse slow result. The current evidence supports reduced client loading cost and fewer backend requests, not a universal elapsed-time improvement.

The deterministic build check passes all 11 configured routes. Their shell JavaScript is approximately 396–401 KB gzip, below the 420,000-byte budget. This budget does not include all route-specific chunks delivered later.

## Backend findings and remaining latency

The database is small at the time of inspection: 138 companies, 139 contacts, 57 products, 16 invoices, 180 events, and 224 email-state rows. Sampled database statistics generally showed millisecond-scale query work; an invoice receivables read averaged about 60ms historically. This does not explain the observed multi-second HTTP waits on its own.

The trace showed common remote calls taking hundreds of milliseconds to several seconds, with occasional 10-second-plus waits or retries. One earlier contact read took about 10.5s; the final cold profile navigation included a 12.6s Auth read and a 5.3s company read. Reducing duplicate requests helps this path, but cannot remove the latency of its remaining required requests.

The performance advisor reported three informational unindexed foreign keys (`company_segments.created_by`, `erp_connection_settings.updated_by`, `erp_inventory.run_id`) and unused indexes. There was no measured evidence that these tiny-table foreign keys caused the page delays, so no speculative indexes were added or removed.

Current production placement already keeps the application and database in US East. Do not move only the application to another continent as a response to local workstation measurements. After a deployment, compare authenticated cold/warm navigations from the actual user location and server-side request timings before making an infrastructure decision.

## Regression verification

`npm run verify` completed successfully: lint, **657 tests / 0 failures**, TypeScript production build, and all 11 shell bundle budgets. `git diff --check` also passed.

The added tests cover complete company pagination, lean field selection, primary contact ordering, consolidated-query errors, concurrent inventory reads and all 1,001 fixture stock records, shared multi-mailbox reads, authorization with React caching disabled, partial avatar failures and URL expiry, avatar invalidation, deferred catalog preparation and exact missing SKUs, and temporary login failures. Existing invoice/payment, mailbox permissions, customer portal, editor, and mutation tests also run in the full suite.

Signed-in browser checks passed for:

- Dashboard and the deferred calendar.
- Company profile, Email, Purchase orders, Analyse, Invoices, Customer portal, and Activity history. An unsaved company-name edit survived tab switching and was restored without saving.
- Segments, Products, invoice list, email workspace, Messenger, Tasks, Automations, Settings, and company catalogs.
- A saved company catalog's PDF preview completed preparation and enabled download.

No browser console errors were captured in the checked final navigations. These are smoke checks, not an assertion that every workflow is bug-free. Real sends, payments, deletions, ERP sync, and account/permission changes were not exercised against live data. Normal existing inbox synchronization can run when its UI opens.

## Ongoing process

Run `npm run verify` before releasing changes. The bundle guard fails when any configured production shell exceeds its budget; investigate global imports before changing the threshold. Add routes as the application grows. Preserve authorization tests and complete pagination when reducing query payloads.

For release verification, use the same company and comparable dataset, record at least cold and repeated warm navigations from the user's region, retain slow samples, and examine the request chain when latency regresses. Measure LCP and INP separately with browser performance tooling or production monitoring; these navigation observations are not substitutes.

Changes are local and reviewable. No deployment or production database migration was performed. Existing unrelated workspace changes were preserved.
