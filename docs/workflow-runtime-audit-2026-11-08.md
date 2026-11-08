# Workflow runtime audit — November 8, 2026

The Shopify segment's failure count is backed by real saved run errors. The workflow enrolled 120 companies, entered its wait for all of them, then failed at its second action (AI auto-reply) for 105 runs. It has one confirmed customer email send and one completed run. The production audit was read-only. Subsequent local verification includes real SMTP authentication and an explicit delivery test to the owner's inbox; customer automations were not executed.

## Exact failure breakdown

| Runs | Saved error | Interpretation |
| ---: | --- | --- |
| 99 | AI Gateway authentication failed. Refresh the development token or configure a valid AI Gateway API key. | The AI email could not be prepared because provider authentication failed. Errors were recorded November 4. |
| 4 | Gemini free-tier request quota exceeded; limit 15 requests per minute, retry requested after about 54–58 seconds. | Historical failures on November 3 from the previous direct Gemini integration. These do not prove the current Gateway account has exhausted its quota. |
| 2 | Email step requires a CRM contact. | Both companies currently have zero CRM contacts and no contact email. A valid recipient must be added before these runs can be restarted. |

Missing-contact company records:

- `/companies/f726acd1-5478-4dc8-b4d2-27d2261ce558`
- `/companies/dc615cb3-54b1-4f92-8b05-80f2eabe290e`

## Waiting and overdue work

At the audit snapshot on November 8:

- Five Shopify runs were overdue from November 6 at 09:00 UTC (17:00 China time), with no execution lock.
- Nine Shopify runs were correctly waiting for November 9 at 09:00 UTC (17:00 China time), following the saved one-business-day wait and resume-time settings.
- Another email-received workflow had two overdue runs. Across 16 live workflows, seven saved runs were overdue.
- Twelve live workflows had no run history. This alone is not evidence of malfunction; receipt triggers require a qualifying incoming event after activation.

The database contains two workspaces. The current scheduler divides 180 seconds by workspace count, giving each workspace 90 seconds. The due-run worker previously required at least 120 seconds remaining before executing anything. Therefore, with two or more workspaces, this code skips all due runs. A regression test reproduced zero deliveries using a synthetic 90-second workspace slice.

The fix separates the fair scheduling slice from the overall invocation deadline. A workspace can begin a due action within its slice when there is enough invocation time to finish it. The invocation deadline is established once, rather than resetting it for every workspace batch. After refreshing the existing Vercel CLI login, production deployment inspection and logs were accessible. Minute cron requests on November 8 around 08:59–09:00 UTC repeatedly returned an empty workflow result despite overdue work. This corroborates the scheduler diagnosis. The local fix has not been deployed.

## Other operational findings

- The original local OIDC token expired November 7 at 13:57 UTC (21:57 China time). The development identity was refreshed through the existing Vercel CLI login. The new credential resolver can renew expired local tokens using the SDK; production continues to use its own request identity. No persistent local AI Gateway API key is configured. Readiness now rejects expired JWTs.
- Local email sending is in dry-run mode. Local simulation cannot establish production SMTP or AI availability.
- Workspace AI automation and email features are enabled, with automatic sending and catalog permission. These settings do not explain the 105 failures.
- The previous runtime made every action exception terminal. Even pre-send authentication or rate-limit problems permanently failed the run. Segment workflows prohibit re-entry, and the scanner treats previous runs of any status as already enrolled; fixing credentials alone does not restart those historical failures.
- Database errors can be plain objects. The runtime previously replaced their messages with “Workflow execution failed.” It now preserves the diagnostic message.
- The existing generic automation diagnostics exercise mock AI and dry-run policy. A passing result does not establish production provider authentication, scheduler progress, or SMTP delivery.

## Local changes and recovery behavior

1. Corrected scheduling slices versus action deadlines.
2. Recognized temporary failures before SMTP submission now retry with exponential backoff, capped at six hours. Persistent failures after the initial five retries remain active but visibly blocked; configuration and missing-data problems are blocked immediately and periodically rechecked. The saved cursor stays on the interrupted action. No finite retry count silently discards the journey.
3. Daily mailbox capacity now defers work until the next UTC day instead of permanently failing the journey.
4. Durable execution checkpoints distinguish preparation from SMTP submission. Safely interrupted preparation resumes; uncertain submission is held for review. Confirmed pre-submission SMTP connection/authentication errors can retry, while unknown outcomes never automatically resend. Deterministic task, notification and timeline IDs prevent duplicate CRM inserts on replay.
5. Expired OIDC tokens no longer report AI as configured, and local tokens can refresh through the existing login. Activation checks authenticate actual sender connections and verify AI access before accepting the workflow.
6. Insights now supports status filtering and pagination, so older failures are accessible beyond the newest 25 runs. Errors and retry events retain their exact reason.
7. Segment progress separates completed, in-progress, blocked and failed runs. Blocked work remains visible under needs attention rather than appearing completed or disappearing.
8. Paused workflows are excluded from due-run selection, preventing paused queues from starving live work. Missing contacts can resolve automatically when exactly one eligible contact becomes available; ambiguous recipients remain blocked.

No failed production runs were reset, no workflow was activated or paused, and no customer email was sent. Only the development identity was refreshed. These local fixes do not rewrite the historical 105 failures.

## Fast testing and honest results

The builder's **Quick test** uses the actual workflow schema and real, read-only dependency checks in parallel. It checks selected SMTP authentication, AI Gateway access, required storage tables, eligible members, products, segment recipients and overdue work. Its dependency budget is seven seconds; timeouts are explicitly unverified. It never sends messages or creates CRM records, and it does not claim future triggers or AI generation have passed.

The original Shopify workflow was checked through the browser in **4.4 seconds**. SMTP authentication, AI access, storage and 57 available products passed. It correctly blocked the two companies without email contacts and warned about the five overdue runs and local dry-run mode. A separate Gateway access probe completed in 1.371 seconds without generation or credit spend.

**Send test email** uses the original email/AI action implementation, an explicitly selected test inbox and a test-only execution record. Fast timing skips waits without changing the saved flow; scheduled timing remains available. Only email actions execute: tasks, alerts and customer updates are explicitly excluded. Generated messages carry a `[Workflow test]` subject prefix. The UI reports mail-server acceptance, which is distinct from inbox delivery. AI generation and external mail servers cannot be guaranteed to finish in one second.

The original Shopify AI action completed a real fast delivery test on November 8. Test record `9dfa4105-702f-4c64-b70e-489a019ccb45` started at 09:13:19.980 UTC and was accepted by SMTP at 09:14:50.536 UTC (90.556 seconds). It generated the reply and attached the 699,770-byte product catalog plus the configured email footer assets. The completed result and acceptance timestamp were verified in both the database and browser. Only the authenticated owner's test inbox was addressed; inbox receipt was not independently checked. This is evidence of the current local AI/catalog/SMTP path, not proof that every future recipient or provider response will succeed.

## Validation and remaining recovery work

All **1,719 repository tests** pass, along with changed-file ESLint, TypeScript and an optimized production build. Verification covers waits, conditions, nested branches, email templates, AI reply options, task creation, property updates, customer tags, internal alerts, stop outcomes, sender selection, enrollment/re-entry, concurrency, SMTP uncertainty, retry checkpoints, missing-contact recovery, credential refresh, activation probes and quick-check timeouts. The runtime suite also exercises all 100 ordered action pairs across nested paths and durable waits using intercepted delivery. These automated action tests use controlled adapters; the live browser dependency and delivery checks are reported separately.

Before recovering the historical failures:

1. Restore and verify AI credentials in the actual execution environment. Temporary development OIDC tokens must be refreshed, or a suitable AI Gateway API key configured securely for local/standalone workers.
2. Deploy the scheduler and recovery changes through the normal release process.
3. Add the missing contacts to the two identified companies.
4. Review failed histories and outbound messages, then explicitly restart only appropriate runs at their failed action. Do not re-enroll the whole audience or replay completed sends.
5. Verify scheduler progress and one controlled delivery before releasing a larger backlog.

Production platform inspection and logs were verified using the restored CLI login, without retrieving or using the production cron secret. Automatic approval review blocked a staged production deployment because this working tree contains extensive unrelated pre-existing changes and publishing that whole release needs explicit scope approval. No deployment artifact was created. The fixes remain local pending release approval.
