# Vercel production review — 5 November 2026

Project: `filazoo-crm`, team `nex8gens-projects`.
Production: https://crm.filazoosupply.com

Final verified release: [`dpl_3GvMgxAsw6ZuC3SEJGyiwKQkuLxN`](https://vercel.com/nex8gens-projects/filazoo-crm/3GvMgxAsw6ZuC3SEJGyiwKQkuLxN), Next.js 16.4.5. Its staged health check returned HTTP 200 with the database connected. The patched build, lint, all 1,199 tests and all route bundle budgets passed. The earlier setup-fix release also completed natural workflow ticks without new error/fatal logs during the observed window.

Follow-up release: [`dpl_DFiQA1w8nU7qMTWTYp4j7VCEAfRB`](https://vercel.com/nex8gens-projects/filazoo-crm/DFiQA1w8nU7qMTWTYp4j7VCEAfRB) fixes the Shopify importer's loss of plain database error messages. Its build, health check and ten relevant tests passed before publication. The separate missing Shopify theme connection was subsequently repaired and published by the owner; see [the live form connection report](shopify-crm-form-connection-20261105.md).

## Changes

- Installed Vercel Web Analytics and Speed Insights and mounted them in a dedicated client component inside a root Suspense boundary.
- Excluded the two Vercel telemetry endpoints from the staff session proxy. Removed URL searches, fragments, customer access keys and UUID record identifiers from reported URLs.
- Changed the authenticated workflow cron to return 202 promptly and run its independent phases through Next.js `after()`. This avoids holding the shared pg_net HTTP batch open during workflow processing.
- Added cooperative execution budgets. Recovery scans queue new runs instead of executing an unbounded chain of actions inline. Active runs yield only between saved actions, retaining their position for the next tick; in-flight SMTP sends are not raced against a timeout.
- Bounded mailbox imports, scheduled send claims and auto-reply checks. Existing database claims and duplicate-delivery protections remain in use.
- Excluded local logs and MCP configuration from deployment uploads.
- Included all existing workspace changes in the production release, as explicitly requested by the owner.
- Patched Next.js from 16.4.0 to 16.4.5 and applied the Zod security patch after the dependency audit identified affected installed versions.
- Applied compatible lockfile security updates without `--force`. Capped build workers and the default test concurrency at two after reproducing local memory exhaustion.

## Evidence

The three red integration branches shown in the screenshot all failed while prerendering `/companies/[id]`: client rendering was requested outside a Suspense boundary. These are historical failed deployments; changing the current source does not alter their status.

Before this release, production logs repeatedly showed `/api/cron/flows` reaching the 300-second runtime limit. Other historical clusters included Supabase upstream outages/schema-cache failures, query timeouts, refresh-token contention, two failed Shopify imports, and background mailbox/tagging retries. Historical records are not proof of a current failure and were not erased or blindly replayed.

After the initial promotion, the production sign-in page, database health endpoint, Analytics script and Speed Insights script all returned HTTP 200. Project settings confirmed Web Analytics enabled, Speed Insights configured and Fluid Compute enabled. The natural scheduler cleared its HTTP queue and returned 202 acknowledgements. Logs on the new deployment confirmed all four workflow phases completed; the remaining timeout entries belonged to the preceding deployment's already-running requests.

## Validation

- Production build and TypeScript validation passed.
- ESLint passed.
- All 1,199 unit/regression tests passed with test concurrency limited to two to fit the local machine's memory.
- All twelve measured route shells passed the existing 420 KB gzip bundle budget.
- Added regression coverage for prompt cron acknowledgement, authorization, health checks without side effects, independent phase failure handling, deferred workflow recovery without duplicate delivery, expired execution budgets and telemetry URL redaction.
- Confirmed database migration names for the existing workspace AI changes are present in production, including `workspace_ai_task_routing`.

## Limits and remaining review

- Analytics and performance dashboards need real browser visits after deployment before they can display measurements; script availability alone does not prove that a visitor event has been ingested.
- The checklist's “Upgrade to Speed Insights Plus” is an optional paid upgrade and was not purchased. [Vercel documents that the CLI enable action upgrades to Plus](https://vercel.com/docs/cli/project).
- With explicit owner approval, inspected only the two historical failed Shopify import error messages. Both contain only `Shopify lead could not be saved.` The importer discarded messages from plain PostgREST error objects; this reporting defect is fixed with regression coverage. The original database causes cannot be recovered from the saved messages. Both records remain failed and were not replayed; no lead payloads were read or emails sent by this investigation.
- The compatible dependency update leaves 16 npm advisories: zero critical, three high, eleven moderate and two low. The three high findings form the legacy `imap` → `utf7` → `semver` dependency chain; `imap` is used by the verification script, while application mailbox access uses `imapflow`. npm's remaining automatic recommendations include breaking downgrades, which were not applied.
- Historical infrastructure outages cannot be repaired retrospectively in application code. Continued observation is needed to establish longer-term reliability.
- The framework patch addresses the [Next.js cache-function advisory](https://github.com/advisories/GHSA-673q-mjm6-r5xr) and brings the framework above the [image-optimization advisory's affected range](https://github.com/advisories/GHSA-2464-fhr4-w9xw). The audit and compatible dependency update output are retained locally under `tmp/vercel-setup-*`; remaining advisories must not be represented as a clean security audit.
- Browser automation could not attach during this session. Verification used deployment metadata, build output, HTTP responses, database scheduler metadata and runtime logs; a signed-in interactive CRM walkthrough was not performed.

## References

- [Vercel Web Analytics quickstart](https://vercel.com/docs/analytics/quickstart)
- [Vercel Speed Insights quickstart](https://vercel.com/docs/speed-insights/quickstart)
- [Next.js after](https://nextjs.org/docs/app/api-reference/functions/after)

Local diagnostic files contain operational settings and are excluded from source uploads. Do not publish them as artifacts.
