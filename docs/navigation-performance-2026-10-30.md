# Navigation and session memory

Date: 2026-10-30 (UTC+8)

## Behavior

- Settings navigation lives in `app/settings/layout.tsx`. Changing sections replaces the content area while keeping the navigation, search control, and layout mounted. Content loading placeholders no longer replace the sidebar. The apps library and individual connection screens use the same layout.
- Visited route payloads remain reusable in the browser for up to 30 minutes, instead of one minute. Framework memory limits, explicit refresh, and server-action invalidation still apply. This is a browser cache; no shared cache was added for private CRM data.
- The account-scoped workspace memory retains searches, applied filters, sorting, columns, and pagination for companies, products, company catalogs, Meta leads, segments, invoices, analytics, and My Day. Settings search, app-library filters, and an unsaved profile display name also survive route unmounting. Company segments and invoice company/status/detail contexts use separate keys.
- Invoice rows are retained alongside their matching filters and page number. Background server refreshes update the appropriate filtered listing. Memory pressure evicts all fields of a view together, avoiding mismatched rows and pagination.
- Memory is bounded to 200 entries, is never written to browser storage or disk, and is recreated when the account changes. Logout performs a document navigation to clear the preserved account state. This does not promise indefinite retention of every mounted form or survive a full browser reload.
- Older route snapshots refresh after five minutes in a React transition, keeping existing content visible. Hidden browser tabs skip the refresh; leaving a route removes its timers/listeners. Inbox, Messenger, automation, and My Day retain their own refresh behavior.
- Independent settings/team and app-connection reads run concurrently.

## Browser evidence

Verified against the local production build on port 3100 with the existing signed-in session:

1. Entered a temporary, unsaved profile display name; visited Appearance, Security and login, Payment methods, and General; returned to Profile. The draft was restored after exceeding the framework's three-route mounted-state limit. The settings sidebar stayed mounted. CDP recorded no document or `_rsc` page-data request on the return; avatar image resource events were present.
2. Applied a company search; visited Segments, Settings, and Analytics; returned through primary navigation. The search and its one matching company were restored. CDP recorded no document or `_rsc` page-data request on the return.
3. Browser Back and Forward restored the same filtered company view.
4. Browser warning/error logs were empty. Temporary names and filters were restored without saving any CRM records or settings.

These are functional cache checks, not measured page-load timing improvements. First visits still fetch their required data. No deployment was performed.

## Validation

- Production build, including TypeScript and prerendering: passed.
- ESLint: passed.
- All 12 production-shell JavaScript budgets passed the existing 420,000-byte gzip ceiling. Companies: 339,776 bytes; settings: 350,294 bytes. These measure shell scripts, not total route downloads or live latency.
- Regression coverage exercises account isolation, retention beyond three views, falsy values, subscriptions, bounded/grouped eviction, recent-page request suppression, background refresh transitions, query-specific freshness, and timer cleanup. Existing settings authorization and profile/data-read performance tests were also exercised.
- Final full test suite: 1,049 passed, one failed. The remaining pre-existing translation-coverage check reports four untranslated strings in `components/flow-sender-field.tsx`; none comes from the navigation changes.

Two small compatibility fixes in concurrently added quotation routes were needed to complete validation: keep JSX outside a data-loading try/catch, and remove the redundant route `runtime` export rejected by the installed Cache Components version. Other quotation behavior was retained.
