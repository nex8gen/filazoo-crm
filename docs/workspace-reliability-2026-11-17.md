# Intermittent workspace and page failures — 17–18 November 2026

The failures affected navigation → authentication → live workspace-session validation → tenant-scoped database reads → page rendering. They were not limited to Workflow or the browser connection.

## Evidence and cause

- Production logs recorded session TimeoutErrors, database schema-cache failures, and Auth HTTP 409 conflict responses from simultaneous refreshes. Scheduled workers also failed to load workspaces.
- Live session reads took 7.3, 2.6 and 12.2 seconds. The last spent approximately 11.7 seconds upstream. The old seven-second attempt deadline cancelled valid responses.
- After reconnecting Supabase, diagnostics showed CPU at 99%, severe memory pressure and nearly exhausted disk I/O allowance. Query-performance history attributed 32.9% and 21.5% of execution time to two reads repeatedly transferring full mailbox message histories.
- The snapshot commit RPC mentioned messages and uid_validity during unchanged polls, unnecessarily invoking the history trigger.
- Error buttons used the installed Next.js version's reset, which rerenders the failed snapshot, instead of retry, which fetches fresh content.

The provider also returned a transient Cloudflare 521. Recovery cannot make a sustained provider outage available, but premature deadlines, duplicate requests and excessive mailbox work were application defects.

## Corrections

1. Known reads use a transport that buffers complete responses, handles body disconnects and gateway failures, respects cancellation and retries once. The total budget is 31 seconds with 15 seconds per attempt. Nested database SDK retries are disabled.
2. Identical in-flight session lookups and credential refreshes are coalesced, including credentials and tenant context in the request identity. Completed and failed entries are immediately removed; completed authorization is never globally cached. Caller-specific cancellation bypasses session sharing.
3. Only refresh-token HTTP 409 responses with code conflict become retryable infrastructure failures. Temporary authentication failures remain recoverable instead of becoming login redirects or erased sessions. Invalid/revoked credentials still fail. APIs retain the explicit pre-execution 503 marker.
4. Page and intercepted-company error buttons use Next.js retry.
5. Mailbox reads check fresh tenant-scoped metadata every time and reuse only message JSON with an unchanged database revision. Messages or UID changes invalidate that revision; metadata-only commits preserve it and avoid the history trigger. The cache is bounded to 32 MiB/64 entries, separated by workspace and mailbox, and returns independent objects. Deleted, inaccessible and failed reads never return cached rows. A legacy-schema fallback supports additive rollout.

The 43 saved snapshots contained approximately 21.9 MB of message JSON; combined metadata was approximately 14.9 KB. Warm unchanged reads avoid transferring the message payload. This is a payload reduction, not a claim of an equal CPU reduction.

Writes and arbitrary RPCs are not automatically replayed. RLS, current membership validation and worker lease fencing remain enforced. No customer records, mailbox history or cron logs were deleted; no paid infrastructure settings were changed.

## Database release

Applied migration: 20261117155353_mailbox_snapshot_revision_reads.sql, project hukbmbicpdmhoxpkvljz. The local filename matches the migration version assigned by the connected service.

Live transaction tests verified metadata-only revision reuse, message/UID invalidation, lease release, rejection of incorrect worker owners and snapshot leases, and enabled RLS. All fixture writes were rolled back; a follow-up query found zero fixture rows. All 43 real snapshots have revisions. Background sync jobs subsequently reported successful completion.

Post-change security advisors reported only the existing informational notice about workspace_invitations having RLS without public policies; that table is intentionally restricted. Performance advisors reported existing indexing/policy observations outside this mailbox correction.

## Application release and verification

Live production deployment: dpl_Gfjfdk5gUm2TSBYZbn5EkKvx7byP, serving https://crm.filazoosupply.com. Source fingerprint: 22f0ed8ab36e94bf77f5765455257ef3ca7eabbaf1d9bc9d4dcd32217e858a00. All reliability runtime files were compared with the deployed source and matched, including the mailbox reader and integration. The separately staged isolated candidate was not promoted because the newer live release already included these fixes and concurrent work.

- Full test suite: **2,414 passed, zero failed**, including mailbox revision reads, session concurrency/deadlines/cancellation, tenancy, refresh recovery, actual Auth SDK behavior, error recovery and mailbox phase regressions.
- Targeted ESLint, TypeScript, whitespace checks and the supported optimized production build passed.
- Eight parallel actual control clients shared one HTTP session read and succeeded in approximately 1.7 seconds without reading private user records.
- Live and local health endpoints returned HTTP 200 with database connected. The staged app also returned the expected 307 login redirect for unauthenticated Workflow access and 401 for the protected task API.
- Signed-in Chrome loaded Workflow, Home, Files & templates and Settings without either reported error screen. Navigation back to Workflow passed after restarting the normal localhost:3000 runtime onto the verified build.
- Production runtime error queries returned zero errors from 15:54:00 to 16:01:02 UTC on 17 November, after the database change. This seven-minute window does not guarantee future provider availability.

Authenticated navigation was verified locally. The production browser was at sign-in, so production verification used health, access-control responses, deployed-source comparison and runtime logs without creating or impersonating a user session.

## Operational limits

Sharing and caching are scoped to a server process; cold instances still load current messages. A sustained database/authentication outage can still interrupt access. The changes correct recovery behavior and avoid the identified redundant load. Retain these regression tests and check production errors after future releases.

Reference: [Supabase automatic retry behavior](https://supabase.com/docs/guides/api/automatic-retries-in-supabase-js).
