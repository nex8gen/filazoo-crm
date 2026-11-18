# Loading performance — 17 November 2026

Reduced unnecessary downloads across the workspace and checked every generated page shell. This report records the initial local bundle work. The subsequent investigation and hosted release are recorded in [the hosted performance report](hosted-performance-2026-11-17.md).

## Changes

- Company profiles defer the Email, Analysis, and Customer portal client bundles until the corresponding server section renders. The existing selected-tab data reads, permissions, and preservation of visited tab drafts remain in place.
- Workspace loading placeholders no longer depend on the sign-in frame and its artwork. Sign-in shaders load separately, only on desktop when reduced motion is disabled; the CSS background renders immediately.
- The notification bell downloads task/email item renderers when opened. Workflow inspectors, invoice editing, catalog attachments, and portal previews have separate loading boundaries.
- Product image uploads load the browser storage client when an upload begins. Products and email replies load PDF-generation code when generating a PDF.
- Customer-tag revision polling runs on company views and intercepted company profiles. Other screens avoid that extra request; inbox data retains its own refresh path.
- Document previews share one details request for the email design and related attachments. Closing a preview aborts that request. Template cards defer HTML generation until they approach the viewport.

## Measurements

Production builds use the installed Next.js 16.4.5 and the same local configuration. Values sum unique JavaScript files, gzipped individually with Node's gzip implementation. Client entry sets include shared dependencies, overlap the HTML shell, and must not be added to shell totals. They exclude subsequent interactive downloads and do not measure authenticated load times or LCP.

| Measured set | Before gzip bytes | After gzip bytes | Reduction |
| --- | ---: | ---: | ---: |
| Products client entry | 276,162 | 201,097 | 27.2% |
| Portal theme library client entry | 196,169 | 174,869 | 10.9% |
| Workflow client entry | 384,814 | 373,611 | 2.9% |
| Email client entry | 377,192 | 366,813 | 2.8% |
| Analytics HTML shell | 369,144 | 338,225 | 8.4% |
| Settings HTML shell | 376,113 | 345,263 | 8.2% |

The company profile shell fell from **707,538 to 392,690 gzip bytes (44.5%)** in a staged comparison: the before measurement was taken after the first deferred-feature changes, immediately before isolating the company tab bundles and sign-in artwork dependencies. It is not the original baseline for the other rows.

[The measurement snapshot](loading-performance-2026-11-17.json) includes all measured shell and client-entry values.

## Verification

- Production compilation, TypeScript, and prerendering passed.
- ESLint and `git diff --check` passed.
- All **64 generated HTML shell budgets** and **5 client-entry budgets** passed. The existing 420,000-byte shell ceiling remains; the internal `/workflow/qa` fixture has a separate 560,000-byte ceiling because it renders an entire populated editor at build time. The new Products and portal entry limits catch reversions to their larger baseline bundles.
- All 56 focused workflow/loading tests passed. Four new tests cover shared preview requests, empty/trashed previews, cancellation with a late response, and deferred offscreen rendering. Existing workflow tests continue exercising the same panels behind mocked import boundaries.
- The full workspace run passed 2,388 of 2,390 tests. One failure is the same pre-existing Chinese-copy coverage gap in `flow-text-email-editor.tsx` observed in the baseline. The other was in the concurrently changing inbox refresh path; all 9 inbox-route tests passed on a subsequent isolated run. Concurrent authentication/mailbox changes were preserved and are outside this report's performance implementation.
- A local production browser check rendered the sign-in screen. There was no active local CRM session, so authenticated page timings, all signed-in screens, and real upload/send/save operations were not verified in the browser.

The initial baseline build encountered malformed generated `.next/dev/types` files. They were backed up to `/tmp/filazoo-perf-dev-types-20261117`; the production build then completed without changing TypeScript validation settings.
