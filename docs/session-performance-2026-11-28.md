# Session navigation and loading performance

Date: 2026-11-28 (Asia/Shanghai)

## Behavior

- Visited route payloads stay eligible for reuse in the current browser tab for 24 hours, increased from 30 minutes. This is in-memory session caching. Reloading the document, signing out, saving data, explicit refresh, network recovery, and Next.js memory eviction can still require fresh reads.
- Removed the global five-minute router refresh. In the installed Next.js implementation, that refresh invalidates the dynamic back/forward cache, including previously visited routes. Routine tab focus and return navigation no longer trigger this invalidation.
- After an observed network outage, the workspace refreshes once when online and visible. Hidden tabs defer this work until visible. Live inbox/customer-context polling, tag revision checks, server-action invalidation, and explicit refresh controls remain active.
- Remembered view state resets when the user, workspace, or workspace role changes. Private CRM snapshots are never stored in a shared server cache or persisted to browser storage by these changes. AI readers and assignment checks are unchanged.
- Client pagination caches retain the 50 most recently used pages per mounted cache, with identical pending reads deduplicated. Invalidation prevents old reads from repopulating cleared caches.
- Shared background polling prevents overlapping requests while a slow request is pending, including when React Activity hides and reveals a route.
- Sidebar sections retain their component identity across navigation. Opening a document's source record now uses client navigation, preserving browser session memory.
- Products defer the description, media, volume-pricing, and variant editors until an editor is rendered. Workflow analytics downloads its chart after hydration, with a reserved loading area.

## Bundle measurements

Measured with the existing `scripts/audit-client-bundles.mjs` against production builds before and after this change. Values are unique JavaScript files, gzipped individually. Client entries overlap HTML shells and must not be added to them. These are download-size measurements, not authenticated navigation latency or LCP.

| Measured set | Before gzip bytes | After gzip bytes | Reduction |
| --- | ---: | ---: | ---: |
| Products client entry | 337,932 | 282,134 | 16.5% |
| Product detail HTML shell | 514,073 | 458,276 | 10.9% |
| Workflow analytics HTML shell | 498,772 | 391,819 | 21.4% |

The workflow analytics shell now passes its existing 420,000-byte budget. The overall bundle audit still fails: six other shells and all five configured client entries exceed their existing limits. The baseline already failed seven shell budgets and all five entry budgets. Budget thresholds were not relaxed.

## Validation

- Production compilation, TypeScript checking, and prerendering passed.
- ESLint completed with no errors; three existing warnings remain in `components/marketing/reference-marketing-site.tsx`.
- All 182 tests across 26 relevant product, document, email, pagination, polling, and navigation test files passed. A separate 45-test focused run also passed, including company-profile authorization and loading checks; these counts overlap.
- Updated the workflow analytics test's dynamic-import mock and the Settings test's icon mock. Corrected the product PDF assertion to inspect rendered text rather than matching numeric vector-logo coordinates as an internal price.
- This work did not deploy the app or verify authenticated browser latency. Restart the running app to activate the updated Next.js cache configuration; production use requires the new build.
