# Workflow architecture and reliability review

Reviewed 11 November 2026, approximately 08:24–08:32 Asia/Shanghai.

Follow-up: [Live lead and incoming-email reconciliation](workflow-live-reconciliation-2026-11-11.md) compares actual submissions, mailbox messages and run results. It identifies missing form context, an orphaned live segment, personal-mailbox coverage gaps and a more specific cause for the verification failures. Read it alongside this structural review.

The workflow feature has a viable foundation, but its execution boundaries and recovery controls need work. A replacement canvas will not address the identified failures. Preserve the builder, schema validation, persisted waits and existing action adapters; repair event ingestion, send-time checks and recovery, then separate background work into independently bounded jobs.

## Evidence and limits

- Read the current editor, API routes, workflow runner, mailbox projection, send policy, SQL migrations, previews, diagnostics, task workflows and AI workflow runner.
- Queried the connected Supabase project read-only, including current runs, redacted action/error histories, scheduler metadata and mailbox freshness.
- Queried production Vercel deployment metadata and runtime logs. Local HEAD and the latest production deployment both identify commit `dcbeb1521171da56616e8e1bdf4b79d5386c1a94`. This does not make unrelated uncommitted local changes part of production.
- Ran nine relevant existing test files: **127 passed, 0 failed**. These cover runtime, cron, validation, preview, quick checks, delivery tests, SMTP, agent workflows and task workflow execution.
- Ran three additional local probes against the actual runtime source with the repository's in-memory adapters. Results appear below. SMTP and AI were intercepted.
- Researched official Klaviyo, Mailchimp, Next.js and Vercel documentation. Competitor product behavior is documented; their private implementation is not inferred as fact.
- No customer automation was executed, restarted, paused or edited. No real email was sent. Application code and dependencies were unchanged. No browser interaction or inbox placement test is claimed.

Earlier November 5/8 reports describe historical credentials and scheduler failures. They are useful context, but their counts are not the current database state.

## Current saved state

Database snapshot: **11 November, 08:24 China time**. There are three workspaces and five saved live flows in the connected project.

| Workflow | Runs | Completed | Active | Failed | Current interpretation |
| --- | ---: | ---: | ---: | ---: | --- |
| 新线索AI首次回复及5小时提醒 | 4 | 2 | 2 | 0 | First reply and later reminder paths have recorded sends; two runs are waiting. |
| 需要跟进 auto workflow | 2 | 2 | 0 | 0 | Both runs completed after skipping their email. Follow-up inspection found that its saved segment is now missing. |
| 精选优质客户（巴西及欧美） auto workflow | 1 | 1 | 0 | 0 | One recorded email send. |
| PETG-CF auto workflow | 1 | 0 | 0 | 1 | `Address is not verified`. |
| 跟进 auto workflow | 1 | 0 | 0 | 1 | `Address is not verified`. |

There are **seven `email_sent` events**. These are application records of accepted sends, not independent proof of inbox delivery. No active run was overdue at this snapshot. The two active waits were scheduled for approximately **08:53 and 12:01 China time on November 11**.

Correction after mailbox reconciliation: both failed runs target the same unverified contact, Bonita at KingTon. She has no saved form inquiry source and no inbound rows in the workflow's CRM email table, but her actual mailbox contains customer inquiries, including one before the failures. The runner cannot see that evidence. This makes the verification failure a consequence of missing ingestion data as well as an unrecoverable policy outcome; changing verification alone is an incomplete diagnosis.

Minute workflow resume/inbox cron jobs are enabled. Recent database cron invocations succeeded. Sampled HTTP responses were 200/202, but those records include multiple background routes and do not prove every background phase completed.

## How the feature currently works

1. `components/flow-builder.tsx` authors a tree of actions and branches.
2. `lib/flows.ts` validates triggers, action configuration, nested paths and re-entry options.
3. `lib/data/flows.ts` calls the transactional `save_automation_flow` RPC.
4. Direct CRM/intake events and `scanTimeBasedFlowTriggers` discover eligible entries.
5. Enrollment creates a `flow_runs` row containing a serialized action definition.
6. `processFlowRun` claims the row, expands the selected branch into the saved action sequence, persists waits, and executes actions.
7. `executeEmail` evaluates recipients, prepares content/catalogs, submits SMTP, then records the accepted result.
8. Database cron invokes `/api/cron/flows`, which uses Next.js `after()` to run workflow processing, scheduled email, conversation auto-replies and tagging.

There are also distinct task-workflow and AI-agent workflow runners. Distinct business processes are reasonable, but they currently implement overlapping delivery, status and recovery behavior. Shared sending rules and delivery receipts should be reusable across them.

## Findings, ordered by impact

### 1. Mailbox-to-workflow synchronization is starved by the workspace budget — high

**Confirmed in current code and reproduced locally.**

`app/api/cron/flows/route.ts:19` assigns `180000 / workspaceCount` milliseconds to workflow work. With three workspaces, that is **60 seconds**. `lib/data/flow-runtime.ts:809` passes this deadline to `syncFlowMailboxMessages`. At `lib/data/flow-mail-sync.ts:15`, synchronization returns unless at least **95 seconds** remain. It also applies that requirement before reading each mailbox. Even two workspaces produce only 90 seconds.

The probe invoked the actual synchronization function with a 60-second deadline. It returned with **zero database calls**.

The independent mailbox worker updates the mailbox cache; the flow synchronizer projects messages into the `emails` table used by `loadFlowFacts`. Those are different stages. At inspection, mailbox snapshots were fresh on November 11, while the newest CRM `emails` row with `direction='received'` was dated November 5. This supports a projection freshness gap. It does not prove every cached message should qualify for automation. No cached post-send reply was found for the four current new-lead runs, so a missed reply for those specific customers is not claimed.

**Change:** give cache projection its own short, bounded job with an incremental cursor. Do not require an IMAP-sized reserve merely to read cached messages. Expose a projection watermark and prevent reply-sensitive sends from relying silently on stale ingestion.

### 2. A pause or unsubscribe during AI preparation is not checked before SMTP — high

**Reproduced locally; no production occurrence established.**

`executeEmail` checks the flow/contact/filter/send policy, then awaits AI generation and attachment preparation. Before SMTP, it rechecks AI automation permission, but does not reload the flow status, contact unsubscribe state, suppression, profile filters or new reply state. `processFlowRun` reads flow status once before the action sequence.

The probe changed the flow to `paused` and the contact to `unsubscribed=true` inside intercepted AI preparation. The actual runner still called intercepted SMTP **once**.

**Change:** persist prepared content, then immediately before submission revalidate the current flow/step revision, recipient policy and relevant engagement state. Record why a prepared message was cancelled. This reduces the race window; an email already submitted to SMTP cannot be recalled by pausing.

### 3. Recipient readiness and failure recovery disagree — high

**Confirmed by two current failed runs and a local probe; the live cause is refined by the follow-up reconciliation.**

`lib/data/flow-check.ts:95` checks whether segment companies have an email address, but does not apply the full send eligibility rules. Activation validates sender/AI/resources rather than the actual audience's send eligibility. At execution, `lib/data/flow-runtime.ts:300` applies `evaluateSend`; an unverified address without inquiry evidence visible to the runner throws a normal error and becomes terminal `failed`. Bonita's inquiries exist in the mailbox cache but are absent from that runner data source.

A local probe reproduced `failed`, changed the contact to verified, and invoked the runner again: it remained `failed` and sent nothing. This is consistent with the runner's early return for non-active runs.

**Change:** repair inquiry ingestion and reuse one structured eligibility evaluator in audience previews, readiness checks and delivery. Distinguish missing evidence, policy skips and execution failures. Keep unsubscribe/suppression as delivery restrictions. Review Bonita's actual inquiries and manual replies before deciding whether either failed action should resume.

### 4. Previous entry permanently excludes recovery, and there is no failed-run recovery UI — high

**Confirmed current behavior; partly an intentional product rule.**

`lib/flows.ts:271` explicitly restricts segment audiences to no re-entry. `lib/data/flow-runtime.ts:682` builds `enteredCompanies` from every saved run, regardless of whether it completed, skipped or failed. The enrollment check similarly treats any previous run as entry history.

No re-entry can be a valid campaign rule. The gap is that repairing the cause of a failed action is different from enrolling the company into a new journey. The current Insights UI supports history, filtering and refresh; no authorized resume/reconcile action was found in the flow API/UI.

**Change:** add a recovery operation for a saved run with an action receipt and revision check. Allow retry only for confirmed pre-submission failures. Hold uncertain SMTP outcomes for reconciliation. Keep recovery separate from marketing re-entry, and never restart an entire audience to repair one failed action.

### 5. Completed runs can obscure that no message was sent — medium

**Observed in two current runs.**

Both `需要跟进 auto workflow` runs logged `email_skipped` with `Profile or message filters no longer match`, then became `done`. Skipping is sensible. Presenting only journey completion makes it easy to assume the email was delivered.

**Change:** retain journey completion, but show per-message outcomes prominently: waiting, sent/accepted, skipped with a specific reason, blocked, uncertain, failed. Include recipient/company identity and the relevant timestamps in run history. Current generic filter messages should identify the actual failed condition.

### 6. Long background batches remain bounded by a single function lifetime — high operational concern

**Architecture confirmed; exact contribution to the Vercel email is unconfirmed.**

The supplied Vercel email reports **1,384 execution-time limit hits in seven days, 5.3% of invocations**. That is evidence of project-level timeouts, not a breakdown by route.

Workflow cron configures `maxDuration=300`, a 240-second invocation deadline, and four background phases per workspace. Other routes include mailbox synchronization with provider operations and a warm polling loop, customer reply processing and AI requests. Any of these needs route-level attribution before assigning the full count to CRM workflows.

Next.js `after()` still runs within the route's configured duration; it is not a separate durable queue. See the installed guide at `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`. Vercel terminates an invocation that exceeds its configured duration. [Vercel duration documentation](https://vercel.com/docs/functions/configuring-functions/duration).

Current production samples around November 11, 08:31 China time show workflow phases completing in roughly 2–3 seconds. A query for timeout messages on the current deployment over 24 hours returned none. Seven-day timeout searches exceeded the connector's query budget. These samples cannot confirm or disprove the email's historical total, and do not identify all timed-out routes.

**Change:** make cron dispatch bounded units; persist job/step state and run independent work separately. Track route, workspace, run, step, elapsed time and termination/retry reasons. Increasing duration can buy time but does not repair ingestion, policy or recovery defects.

### 7. Enrollment scans repeatedly revisit history without a durable consumption cursor — medium

**Confirmed code structure; scale risk rather than today's demonstrated failure.**

`scanTimeBasedFlowTriggers` rereads contacts from activation, inbound mail from activation, and extensive outbound/run history for no-reply detection. It pages records, which is good, but starts again at the beginning on the next tick. Slow due actions execute before scans and may consume the budget. Repeated invocations can continually revisit old pages as data grows.

**Change:** persist canonical trigger events, stable event IDs and consumption watermarks. Use a transactional outbox where a CRM write must emit an event. Retain incremental scanners for repair, with saved cursors and fair scheduling. Do not rely exclusively on request-local event emission for reliable change triggers.

### 8. The execution/version and recipient contracts need to be explicit — medium

- Runs snapshot action steps, but reload the latest flow trigger configuration. Editing a live flow can therefore combine old actions with new audience rules. That can be a deliberate policy, but the UI needs to disclose what applies to people already waiting. An explicit published version plus live safety controls is easier to explain and recover.
- Segment enrollment uses `row.contacts?.[0]` at `lib/data/flow-runtime.ts:129`. This does not define which person represents a company with multiple contacts. The later missing-contact recovery is deliberately stricter and refuses ambiguous recipients. Define a primary-contact/selected-recipient rule consistently.
- Business hours are explicitly **09:00–17:00 UTC**, or **17:00–01:00 China time**. This is a documented product limitation, not a timezone calculation bug. Workspace or recipient timezone scheduling would better match common expectations.
- `loadFlows` fetches run counters without pagination, unlike several other loaders. At the Data API row limit, displayed active/completed totals can be incomplete. Use database aggregates scoped to the visible flows.
- Sending counters are read-then-send, Smart Sending is owner-scoped, and bounce rate is passed as zero. These are additional consistency/operational gaps to address in shared delivery capacity management; no current over-limit send is claimed.

Retired sales-stage triggers are deliberately rejected by the schema. Their disabled evaluation is not reported as an accidental missing implementation.

## Comparison with Klaviyo and Mailchimp

| Concern | Documented competitor behavior | Filazoo gap / implication |
| --- | --- | --- |
| Entry and send eligibility | Klaviyo separates trigger filters from profile filters and rechecks profile filters at action time. [Official filters guide](https://help.klaviyo.com/hc/en-us/articles/115002779051). | Filazoo rechecks before email preparation, but readiness and final submission do not share the same complete policy evaluation. |
| Message control | Klaviyo has draft/manual/live per-message states; manual recipients can be reviewed before sending. [Official message management](https://help.klaviyo.com/hc/en-us/articles/115002779271). | Filazoo has whole-flow draft/live/paused. There is no equivalent general per-message review/recovery control in this runner. |
| Editing | Mailchimp documents pausing an entire flow or an individual step to edit it. Klaviyo fixes the selected trigger and documents how live filters/content changes affect recipients. [Mailchimp editing](https://mailchimp.com/help/edit-customer-journey-map/), [Klaviyo editing](https://help.klaviyo.com/hc/en-us/articles/115002779151). | Filazoo allows saved edits with a mixture of snapshotted actions and current trigger configuration. Define the edit contract and prevent pause/preparation races. |
| Results | Klaviyo exposes waiting, review, delivery and skipped-reason activity. Mailchimp reports progress and results for flow steps. [Klaviyo analytics](https://help.klaviyo.com/hc/en-us/articles/115002779351), [Mailchimp flow reports](https://mailchimp.com/help/about-customer-journey-reports/). | Filazoo records useful events, but journey completion and message delivery are easy to confuse; operational recovery is missing. |
| Re-entry and exits | Mailchimp exposes repeat-flow timing, manual contact controls and supported exit conditions. [Official flow settings](https://mailchimp.com/help/edit-customer-journey-map/). | Filazoo's segment journey is once per company for its lifetime. Make this explicit and separate retrying an action from starting a new journey. |
| Event identity | Klaviyo documents event deduplication using profile, metric and `unique_id`. [Events API](https://developers.klaviyo.com/en/reference/events_api_overview). | Filazoo already has event-key uniqueness. Extend it into a durable event ingestion and processing record rather than adding random fallback identities for recoverable business events. |
| Scheduling | Klaviyo supports configured or recipient-local timezone delays. [Official readiness guide](https://help.klaviyo.com/hc/en-us/articles/12414358603675). | Filazoo currently uses UTC business windows. |

These sources establish product contracts and public APIs. They do not establish that either company uses a particular queue, database or orchestration vendor internally.

## Recommended design and sequence

Keep the visual builder as an authoring surface. Its published definition should be input to a reliable executor:

`Event ingestion → idempotent enrollment → published journey version → saved action jobs → preparation → final eligibility check → delivery receipt → reporting/recovery`

1. **Repair the current broken boundaries.** Fix mailbox projection budgeting, add final pre-submission checks, and align readiness with recipient policy. Add meaningful regression coverage for the three reproduced cases.
2. **Introduce explicit action receipts and recovery.** Use stable `(workspace, run, action)` identities, attempts, due times, lease ownership, prepared content and delivery outcomes. A blocked data prerequisite, a skipped message and an uncertain SMTP submission must be distinguishable.
3. **Separate background workloads.** Make inbox projection, trigger consumption, AI preparation, scheduled delivery and tagging independent bounded jobs. Cron should start/dispatch work; one long batch should not be responsible for all workspaces and providers.
4. **Define publishing and editing.** Keep draft and published versions distinct. State which changes apply to existing runs. Preserve pause, unsubscribe, suppression and other live safety controls outside immutable journey content.
5. **Make each customer's result understandable.** Show why they entered, which version/path ran, what they await, which messages were skipped, and the concrete fix available to an operator. Validate the full lifecycle with a controlled test recipient before releasing backlog.

Vercel Workflows is a relevant option for persisted orchestration, waits and retries. Its managed service persists run state and dispatches steps, while each step still executes as a function. It does not remove the need for bounded provider operations, correct business conditions or email idempotency. [Official Vercel Workflows documentation](https://vercel.com/docs/workflows).

A migration should wrap existing action adapters and prove one journey first, with a cutover boundary that prevents both old and new executors sending the same work. An improved Postgres job worker is also viable. The confirmed defects can be repaired before choosing a full orchestration migration; installing a package alone will not resolve them.

## Local reproduction results

The probes reused the current runtime fixture and executed the current source. Temporary probe files were removed after execution.

| Probe | Observed result |
| --- | --- |
| Fail unverified recipient, correct verification, call runner again | `failed → failed`; zero sends. |
| Pause flow and unsubscribe contact during intercepted AI preparation | Saved flow was paused and contact unsubscribed; intercepted SMTP was still called once. |
| Call actual flow mail projection with a 60-second deadline | Returned immediately; zero database calls. |

Existing passing tests protect many important behaviors, including persisted waits, branch selection, send checkpoints and duplicate-worker claims. They use controlled adapters and do not establish live ingestion freshness, provider availability or correct production scheduling. The three additional probes expose combinations absent from those selected checks.
