# CRM performance review

Date: 2026-10-28

## Changes

- Load the workspace AI assistant on first use, with a dismissible loading state. Keep it mounted afterward so closing the panel preserves drafts, conversation state, and running work.
- Stop the document-wide localization observer in English. Switching back from Chinese still restores existing English text before observation stops; Chinese continues observing streamed and dynamically added content.
- Filter single-company reads by ID in the database instead of downloading and mapping the entire company list. Preserve membership checks, sample-data exclusion, company mapping, error handling, demo mode, and full-list pagination. Malformed IDs return a missing record without a database call.
- Load owner names and avatar URLs concurrently once company owner IDs are known.

## Production JavaScript measurements

Measured against the existing working tree before these optimizations, using the same production build command and local configuration. Numbers sum the unique external JavaScript files referenced by each route's prerendered HTML. Gzip estimates use Node's gzipSync; these are bundle measurements, not live network transfer or page-load timings. Dynamically streamed route code and later feature downloads are outside this measurement.

| Sampled page | Before (gzip bytes) | After (gzip bytes) | Reduction |
| --- | ---: | ---: | ---: |
| Dashboard | 468441 | 444527 | 5.1% |
| Companies | 468441 | 444527 | 5.1% |
| Products | 468441 | 444527 | 5.1% |
| Email | 470730 | 446816 | 5.1% |
| Sign in | 474028 | 450114 | 5% |

The dashboard, companies, and products shells reference 18 external scripts instead of 19. Their uncompressed initial scripts decreased from 1442305 to 1361013 bytes. The assistant download moves to the first time the feature is opened.

## Verification

- Baseline: lint passed, 556 tests passed, production build passed.
- Final: lint passed, 561 tests passed, production build including TypeScript and prerendering passed.
- Five added regression tests exercise the CRM data module with a mocked database: ID-scoped reads and mapping, missing/malformed/demo IDs, authorization and database failures, all-page company listing, and concurrent owner name/avatar loading.
- Chrome check against a local production server: sign-in page rendered; Chinese translation worked; navigation to password recovery stayed translated; switching back to English restored text, labels, and title; navigation back to sign-in stayed English. No browser warning/error logs were reported during these checks. No recovery email was submitted.
- No authenticated CRM browser session was available. Company queries were validated with mocks; production database latency, signed-in screens, AI panel open/close behavior, and authenticated write workflows were not exercised end to end.
- Existing uncommitted work was preserved. No deployment or schema change was performed.

## Further profiling

The full company listing still intentionally reads all records so existing filtering, exports, totals, and selection behavior remain correct. Server-side pagination would require coordinating those features. Company catalog listing also waits for missing PDFs to be prepared; moving that work off the response path needs verification of saved version and pricing behavior. These are candidates for a separate authenticated performance pass, rather than changes included here.

## Navigation follow-up

- Set `experimental.staleTimes.dynamic` to 60 seconds. Recently visited dynamic pages now reuse the browser's router cache when revisited through links, instead of expiring immediately. The existing Cache Components setting preserves recently visited page state. Server action revalidation and explicit router refresh still invalidate cached data; this adds no shared server cache for CRM records.
- Keep the last automatic inbox refresh time across Activity effect cleanup/resume. Returning to the email page within its configured refresh interval no longer starts another sync. Focus and visibility events share the same guard, hidden tabs skip polling, and manual Sync remains immediate.
- Verification: lint and production build passed; 17 focused background-refresh, mailbox-switching, and CRM-performance tests passed, including four new refresh regressions. Full suite: 596 passed, 29 failed in email mailbox selection, automation test dependency mocks, and translation coverage outside this change.
- Authenticated browser navigation was not verified: the sandboxed server could not reach authentication, and Chrome blocked access to the subsequent localhost-only network-enabled test server. No authenticated navigation timings are claimed.


## Company detail pages follow-up (2026-10-28)

Opening a company previously waited for its full activity timeline before rendering the profile: events, email bodies, catalogs, sent mail, invoices, payments, invoice audit events, actor names, and actor avatars. All secondary tab server components also executed on page load, including email account/product/catalog reads and purchase analysis.

Changes:

- Added getCompanyProfile for company/contact/billing fields and the current owner's display details. Its initial database group contains three scoped reads (company, contacts, billing profile); history tables and embedded email histories are excluded. Owner name and avatar resolve concurrently after the owner ID is known.
- The page renders only the requested secondary section on the server. Activity history uses the existing complete history loader when selected; no history records or pagination were removed.
- CompanyWorkspace navigates between tab URLs without scrolling the page. Previously visited server sections remain mounted within the company instance, preserving editor state. React Activity pauses hidden section effects. Each selected section receives fresh server props on navigation or refresh.
- Administrator assignment options use names only, avoiding avatar lookups for every BD manager when the actions menu does not display those avatars.
- Existing email compose links, selected-invoice portal links, permissions, primary-contact ordering, billing fields, and profile save actions are retained.

Validation:

- 12 focused regression tests pass, covering lightweight profile queries, owner identity, authorization, missing/malformed/demo IDs, read errors, every server section branch, compose/viewer restrictions, and invoice-context URLs.
- Lint and the production build (including TypeScript and prerendering) pass.
- Full current-workspace suite: 638 of 639 tests pass. The failure is the existing static Chinese-copy coverage check for other in-progress apps/connections and email auto-reply screens; its missing-string list contains no company workspace copy.
- Isolated Chrome UI check using the actual CompanyWorkspace and Base UI tabs with dummy section data: all seven tabs opened; unsaved profile and purchase-order input survived navigation; a simulated server refresh preserved unsaved input and updated the server snapshot. Browser warning/error logs were empty. This fixture used a mocked router and dummy data, so it does not establish live CRM latency or actual Next.js server-streaming behavior.
- The initial local test server was denied network access to Supabase (EACCES), which the existing login handler displayed as an incorrect-password message. A read-only health check with network access returned HTTP 200 and the production server was restarted with working connectivity. The existing authenticated session then loaded the real gantri profile, its purchase orders, invoices, and analysis. An unsaved City field survived the real Next.js tab round trip and was restored without submitting the form. Further tab checks are recorded below. Existing user tabs were left untouched. No company edit or credential change was submitted; no deployment was performed.

- Additional authenticated browser checks: purchase analysis rendered, the customer portal showed its connected paid invoice and conversation, and activity history displayed the existing emails, payments, invoices, and staff note. No browser warning or error was observed in these section checks.

- Final authenticated browser check: the company Email tab loaded its two conversations; revisiting Invoices displayed the previously loaded section; returning to Profile preserved form state. The temporary unsaved City value was restored to its original empty value without saving. All seven company tabs were exercised against the real local production server with no browser warning/error logs. Company profile saves, invoice writes, message sending, and portal mutations were not submitted during this read-only browser pass.
