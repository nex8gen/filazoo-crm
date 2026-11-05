# Workflow action audit — 5 November 2026

The workflow builder saves a validated definition, enrolls a customer when its trigger matches, then executes the selected path through persisted waits, messages, CRM actions and exits. This audit traced the editor, validation, preview and execution code and added regression tests against the actual runner.

The verified changes are deployed to **https://crm.filazoosupply.com** as production deployment `dpl_D943jt8CRoCqhfdBNTXyBAi3oyJL` (`READY`). The deployment used a fixed application-source snapshot and excluded environment files. Existing unrelated AI changes were preserved. No test customer workflow was activated and no historical failed customer run was replayed.

## Issues repaired

| Issue | Resulting behavior | Main evidence |
| --- | --- | --- |
| A delayed worker could claim a run after another worker advanced it and then reuse its stale cursor. | Claims recheck the due time and return the authoritative current cursor and context. Previously executed tasks and newly scheduled waits are preserved. | Deliberately delayed concurrent runner test. |
| Delivery-test polling had the same stale-action race. | Claims compare the current action before allowing a send. | Delayed polling test across two sends and an intervening wait. |
| Split paths and message filters ignored each individual rule's lookback period. | Engagement criteria load facts for their own lookback period, including mixed AND/OR rules. The editor exposes the period, with Chinese translations. | Mixed one-day/open and seven-day/click criteria tested for both splits and email filters. |
| A first wait after a no-reply trigger was measured from the original outbound message. | The wait begins at enrollment after the no-reply trigger delay has elapsed. | A three-hour-old message followed by a new five-minute wait remains scheduled five minutes ahead. |
| Property updates did not emit segment-change events. | Changing a segment starts eligible downstream flows; writing the same value again emits no new event. | Upstream property update and downstream task workflow test. |
| One invalid matching definition could abort enrollment of other flows. | Enrollment failures are isolated per flow. | Invalid email definition alongside a valid task workflow. |
| Mail synchronization failure prevented trigger recovery. | Recovery still runs and the worker response reports the failed phase. | Throwing mailbox-sync fixture with successful new-lead recovery. |
| One malformed saved audience could stop unrelated trigger scans. | Each flow's scan is isolated, with logged errors and worker error results. | Malformed segment rules alongside a valid new-lead workflow. |
| AI sample-email previews omitted the authenticated member's usage identity. | Preview generation receives the member ID required by AI budget enforcement. | Preview attribution test. |
| AI readiness could accept an unused Gemini credential when Gateway was required. | Readiness checks the provider selected by the environment and budget policy. | Provider-selection readiness tests. |
| Signed open/click links rejected valid nested action IDs that were not UUIDs. | Signed tracking accepts action IDs allowed by the definition schema, while retaining signature, expiration and length checks. | Nested runtime email and signed-token tests. |
| An incomplete authored URL could fail email preparation. | Incomplete URLs remain escaped text; valid URLs retain tracking behavior. | Mixed incomplete and valid URL test. |
| The audit did not recognize customer-reply decisions inside split paths. | Both single and compound reply rules count as explicit decisions. | Reply-path audit regression. |
| Generated saved-segment scenarios excluded every customer because assumed membership was missing. | Generated segment-entry scenarios include assumed membership; saved-customer preview still checks actual membership. | Generated branch coverage for a saved segment. |
| Saved-customer previews checked segment re-entry per contact instead of per company. | Segment-audience previews use the same company boundary as enrollment. | Another contact at an already-enrolled company is correctly blocked. |

Email alerts also use the existing connection-only SMTP retry helper and link to the run's current email thread. Mailbox database errors now propagate instead of being presented as a missing sender.

## Action and flow coverage

| Action | Runner coverage |
| --- | --- |
| Send email | All five templates, selected senders, custom content, threading, tracking, message filters, reply protection, Smart Sending, business-hour deferral, catalog attachments and delivery blockers. |
| AI auto-reply | Generation invocation, thread/catalog options, provider readiness, usage attribution, failure handling and synthetic option combinations. |
| Wait | Minutes/hours/days, business days, resume time, successive waits, saved due times, no-reply timing and pause/resume. |
| Split | First matching path, fallback, compound criteria, lookbacks, branch isolation, nested joins and five levels of nesting. |
| If condition | Match/unmatched behavior, continue, skip next and stop. |
| Create CRM task | Owner/specific member, title, notes, due date, priority and duplicate-worker protection. |
| Change customer tag | Persisted tag, downstream category enrollment and subsequent conditions. |
| Property update | Persisted company fields, subsequent decisions and downstream segment enrollment. |
| Internal alert | In-app/email delivery paths, owner/specific recipient, sender selection and conversation links. |
| Stop | Completed/cancelled outcomes and prevention of subsequent actions. |

The screenshot journey is tested with three outcomes: no reply; reply during the first wait; reply during the fallback branch's second wait. The latter two prevent a follow-up email and later CRM tasks.

All 100 ordered pairs of the ten action types are tested against the actual runner on both selected outer branches: **200 runtime scenarios**. Action identities and order are compared with preview traces, waits are resumed from persisted state, and terminal runs are processed again to verify that they cannot send twice. Existing combination tests additionally exercise **2,400 simulated scenarios**. A separate five-level runner test checks wait persistence, branch selection, a nested tracked email, a task and an alert.

The runtime tests execute the application runner against an in-memory database fixture. SMTP and AI calls are intercepted. These checks establish application behavior; they do not prove external inbox placement or live provider availability.

## Validation

- Full repository suite: **1,199 passed, 0 failed**.
- Workflow-related ESLint checks: passed.
- TypeScript `tsc --noEmit`: passed.
- Optimized Next.js 16.4.0 build using the existing stable-runtime configuration: passed; all 102 static pages generated.
- Browser automation: incomplete because the browser-control tool failed during session/tab setup. No successful visual check is claimed.
- Live HTTP checks: `/api/health` returned 200 with the database connected and live sending enabled; `/workflow/qa` returned 200 with the expected canvas and branch content. These are server-response checks, not visual browser verification.

## Live operational evidence and remaining checks

Read-only Supabase inspection found 13 live flows, 8 drafts and 2 paused flows. At inspection, runs included 5 completed and 105 failed, with no active runs. Historical failures comprised 99 Gateway authentication errors, 4 Gemini quota errors and 2 missing-contact errors. The latest observed authentication error was on 4 November at 17:06 China time; historical errors do not establish that today's credentials still fail.

The minute resume and inbox scheduler jobs are enabled. Recent HTTP records include successful 200/202 responses and a five-minute DNS timeout. A successful cron database invocation alone does not prove successful HTTP execution, and the sampled HTTP records include other background jobs.

After explicit user authorization, the read-only Gateway credential check returned **HTTP 200** with a positive credit balance. It generated no AI content and sent no email.

## Background execution release

The cron endpoint now acknowledges authenticated ticks with HTTP 202 before processing provider work. Workflow processing, scheduled email, automatic replies and conversation tagging execute as independent phases, so one phase's failure does not suppress the others. Work has a time budget; workflows checkpoint and unlock between actions, and queued enrollment can be handled by a later tick. Unclaimed scheduled emails remain queued. SMTP submission is never blindly replayed.

The cloud build passed after the release package was corrected to include the shared `hooks` directory. The final archive contains 974 application/configuration files and no environment files or `node_modules`. Source archive SHA-256: `c86d82033d48b95222b9d1941c44fdf14aeba06ddb52bfdcdbc14aada0d64612`.

At **10:10–10:11 China time on 5 November**, deployment-scoped runtime logs confirmed successful workflow, scheduled-email and automatic-reply phases on the production domain. Conversation tagging returned `paused: true` under the existing workspace setting; this setting was preserved. No error/fatal logs were found for the new deployment during the post-release inspection window. Both minute workflow jobs and the ten-second mailbox job remain active. Post-release scheduler HTTP records returned 202 without timeouts.

Live workflows therefore continue on the hosted scheduler when the browser or local computer is closed. Intentional pauses, Stop actions, reply protection, authorization and sending limits still apply. This does not guarantee external provider availability or inbox placement. A controlled live customer-email delivery test was not performed, and historical failed runs were retained for review to avoid duplicate sends.
