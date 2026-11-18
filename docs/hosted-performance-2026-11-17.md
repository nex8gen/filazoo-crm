# Hosted CRM performance — 17 November 2026

The user reported that authenticated navigation still took 30–60 seconds in both local development and local production. Bundle reductions alone did not resolve that delay. Normal use has been moved to the existing hosted address, https://crm.filazoosupply.com, with the application server in US East near the Supabase database.

## Evidence and diagnosis

- Local development traces showed 14–26 second Products requests and a roughly 28 second company profile request. Compilation was generally under two seconds.
- Local production fetch instrumentation showed repeated remote calls taking seconds each: a session RPC took 8.8 seconds, Companies 12.7 seconds, and Documents 7.9 seconds. Some calls reached the 15 second timeout. These waits can accumulate within one navigation.
- Read-only connection probes from the Mac showed variable Supabase auth/database responses, including 10–14 second requests. The existing system proxy did not consistently improve them; proxy settings were not changed.
- Supabase logs also contained schema-cache errors and database/cron timeouts during the investigation. A database restart occurred around 15:24 UTC; this work did not initiate it. Hosting reduces repeated long-distance server/database calls but cannot prevent an upstream database outage.

## Release

- Stable address: https://crm.filazoosupply.com
- Vercel project: `prj_8FpTI4sEU5vUDrochgFpT3IjCXCn`
- Deployment: `dpl_Gfjfdk5gUm2TSBYZbn5EkKvx7byP`
- Deployment URL: https://filazoo-23ee63hg5-nex8gens-projects.vercel.app
- Runtime region: `iad1`; database region: `us-east-2`.
- Tested source fingerprint: `22f0ed8ab36e94bf77f5765455257ef3ca7eabbaf1d9bc9d4dcd32217e858a00`.
- Base commit: `61392a4`. The release includes uncommitted workspace changes captured in an isolated source snapshot; the base commit alone does not identify the deployed source.
- Previous production deployment for rollback: `dpl_5YJJTbY73ByUMYbUsT47z5Rp4oeL`.

The production build was first staged without moving domains, checked, then promoted. The stable domain was inspected after promotion and resolves to the new deployment. Existing authentication and deployment protection remain enabled. No database migration, data deletion, cron configuration, or compute-plan change was performed as part of this release.

## Validation

- All 2,414 tests passed in the isolated snapshot; ESLint passed.
- Vercel production compilation and deployment completed successfully.
- Staged login: HTTP 200, 1.96 second TTFB, 3.09 second complete response from the Mac.
- Staged Companies and Products without a session: HTTP 307; unauthenticated Tasks API: HTTP 401.
- Staged database health: HTTP 200, connected, 3.21 seconds on the first probe and 1.95 seconds on the subsequent probe.
- Promoted stable-domain database health: HTTP 200, connected, 2.25 seconds from the Mac.
- No error/fatal runtime entries were returned for the new deployment in the initial ten-minute log query.
- Hosted login was visibly rendered in Chrome. Public response timings above are not authenticated page-navigation or LCP measurements. Signed-in follow-up checks are recorded below.
- All 25 JavaScript and stylesheet assets referenced by the hosted login returned HTTP 200 after promotion.

## Local use

The normal production launcher now defaults to port 3000; development startup explains that development has different compilation and prefetch behavior. These launcher changes do not remove the measured Mac-to-database latency. Use the hosted address for normal CRM use.

## Signed-in verification — 18 November 2026

The user signed in on the hosted address. Companies → Products → Companies was exercised through the sidebar in Chrome. Populated tables were visible after each transition.

| Transition | Data visible within |
| --- | ---: |
| Email → Companies | 2.77 seconds |
| Companies → Products | 3.05 seconds |
| Products → Companies | 1.37 seconds |
| Companies → company profile | 2.52 seconds |
| Companies → Files & templates | 1.44 seconds |
| Files & templates → Workflow | 3.14 seconds |
| Workflow → Campaigns | 5.39 seconds |
| Campaigns → Customer portal | 6.32 seconds |

These are elapsed upper bounds from initiating the automated click to observing rendered content. They include automation/accessibility overhead and, for Campaigns and Customer portal, the interval before the next observation. They are single observations, not performance percentiles or LCP measurements. Campaigns and Customer portal first showed a loading placeholder, then their content. No writes or message sends were exercised.

Email was already showing its populated inbox when verification began. Messenger conversations and the Home dashboard were subsequently observed loaded, but intermittent macOS screen-capture failures and stale accessibility content prevented reliable elapsed measurements for those transitions. Settings, orders, and analytics were not fully verified visually in this pass. Those automation failures do not establish an application failure.

Vercel's production function-duration query for 00:08–00:39 UTC (08:08–08:39 Shanghai) provided separate server-side evidence. The reported p95 values describe the available requests in this short window; they do not establish a long-term percentile or include network/browser rendering:

| Route | Server duration p95 |
| --- | ---: |
| Companies | 468 ms |
| Products | 328 ms |
| Intercepted company profile | 346 ms |
| Files & templates | 591 ms |
| Workflow | 581 ms |
| Campaigns | 353 ms |
| Customer portal | 154 ms |
| Messenger | 1,640 ms |
| Home | 1,130 ms |
| Settings | 242 ms |
| Email | 3,457 ms |
| Inbox API | 3,885 ms |

The matching query for production function invocations with HTTP status >=500 returned no rows. A warning/error/fatal runtime-log check also returned no entries. The live domain was inspected and still pointed to the release listed above. These results verify the original Companies/Products navigation improvement on the hosted app; they do not claim every route or future database outage has been covered.
