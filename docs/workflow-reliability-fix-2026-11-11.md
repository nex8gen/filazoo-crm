# Workflow reliability implementation and production verification

Verified November 11, 2026, approximately 10:08 China time. Production: https://crm.filazoosupply.com.

Final deployment: `dpl_4Cn18w9hDAeqhxYTEku5TvqJGpdD`. The release was built from production commit `dcbeb1521171da56616e8e1bdf4b79d5386c1a94` plus the workflow changes recorded in [the release manifest](workflow-reliability-release-2026-11-11.json). Unrelated dirty workspace changes were excluded.

## Acceptance criteria and results

| Reported issue | Implemented correction | Verification / live result |
| --- | --- | --- |
| Receipt synchronization exits because its 95-second reserve exceeds a workspace's budget | Bounded cache projection replaces body downloads in intake; receipt projection runs before due actions and again for the selected recipient before submission | Live projection initially recorded 49 missing receipts; minute worker logs show intake completing across all three workspaces |
| Personal mailbox coverage depends on authoring a live flow | Project receipts from every active workspace mailbox, preserving personal owner and mailbox identity | Regression coverage includes a personal mailbox whose owner has no live flow; four live mailbox reply journeys now cover Raul/team, Terrianne, Enphany and Asher |
| AI ignores originating form requirements | Load Shopify/Meta intake before the run's enrollment time; preserve exact origin when available; include requirements in catalog selection and drafting | Real internal email acknowledged PLA/PETG, black/white and 500–999 kg/month without asking for those facts again |
| Sender differs from assigned salesperson | Resolve the customer's active salesperson and personal sender, pin identity to the journey, apply that identity to AI context, products, mailbox, signature and receipt ownership | New-lead flow uses `assigned_owner`; controlled live send came from Enphany with Enphany's signature |
| Pause, unsubscribe or suppression changes during AI preparation can be missed | Re-read live workflow status, recipient, filters, reply facts and suppression immediately before SMTP submission | Race regressions prevent sends after each change; any newly received message invalidates stale AI preparation |
| A reminder can continue after a customer reply | Persist the no-reply guard when the branch passes; check it again at the final send boundary | Reply-during-generation regression stops the reminder |
| Existing customers have no general incoming-email workflow | Four `email_received` journeys use exact receiving-mailbox scope and the appropriate sender; automatic responses are excluded | Enabled at 09:57:20 China time; activation boundaries exclude historical replay; receiving-mailbox configuration is available in the builder |
| Correcting verification cannot recover a stopped run | Missing eligibility data waits with a saved action cursor and backoff; Insights permits authorized rechecks of proven preparation failures | Verification correction resumes the same run; accepted or uncertain SMTP submission is held for review and cannot be automatically replayed |
| A deleted saved segment stays live | Missing audience dependencies are visible and block execution/activation; database trigger prevents deleting audiences used by live or waiting workflows | Production rollback test confirmed the deletion guard; “需要跟进” is paused per the user's explicit choice |
| Completed journeys appear to imply successful delivery | Insights displays sent/skipped counts, skipped reasons and an explicit message for a journey ending with no email sent | History/visibility tests pass, including pagination and blocked/failed run controls |
| Background work shares a function lifetime | Intake, workflow execution, scheduled email and conversation AI replies use separate scheduler requests; webhooks and downstream flow events persist work instead of nesting execution | All four minute jobs enabled; production logs identify separate phases and workspace IDs |
| Preparation can exhaust the next action's remaining function time | AI generation has a shared 90-second budget, hydration has a 30-second budget, and provider actions require a 210-second invocation reserve | Cursor/lock recovery and short workspace-slice tests pass; cheap steps can still persist waits and stops |
| Multiple flows can answer the same incoming message | Atomic workspace-scoped response claim, independent of a flow's enrollment key; final check also recognizes another teammate's saved reply | Two-flow regression submits only once; claim survives edits and safe retry; cancellation preserves claims for earlier sent steps |
| Targeted projection accidentally admits another internal mailbox's messages | Keep the full internal-address exclusion list even when checking a single receiving mailbox | Discovered during the hosted test, corrected, redeployed, and verified against the same live mailbox data: zero internal receipts projected |

The two stale Bonita failures were reconciled against her incoming message and Raul's existing reply, then cancelled without replay. Their original failure history remains available. The older enabled conversation automation stalled by a statement timeout was preserved as paused; future eligible incoming mail uses the new mailbox journeys.

Three older inquiries without a recorded subsequent reply were assigned explicit review tasks: Alex to Asher; Alex Rodriguez and Kristofer Simmons to Terrianne. The task asks the salesperson to check the current conversation and any existing reply before responding. These historical inquiries were not automatically replayed.

## Hosted delivery evidence

Internal-only run: `e0b95f32-089b-47d7-bfd1-324418c586b4`.

- Sender: `enphany@filazoo.com`; recipient: `terrianne@filazoo.com`.
- Subject: `WORKFLOW-QA-20261111: Internal Test Confirmation`.
- SMTP accepted at `2026-11-11T02:01:21Z`; the receiving INBOX cache independently contained the same Message-ID and catalog PDF by `02:03:02Z`.
- Message-ID: `<b542e48c-a7ff-62ba-325e-13cdaa58e1c4@filazoo.com>`.
- Draft used submitted materials, colors and monthly quantity; catalog and sender-specific signature arrived.
- Run persisted a real one-minute wait and completed at `02:03:46Z` with exactly one recorded send. The labelled QA flow is paused after verification.
- The initial test detected new context and scheduled preparation again before SMTP; it did not duplicate delivery. The internal-address edge case uncovered by that test was subsequently fixed and checked against live data.

## Validation and limits

- Final focused workflow/integration suite: **277 passed, zero failed**.
- Full release suite before the last small receipt guard/test additions: **1,795 / 1,797 passed**. The two failures concern existing home/marketing translations and the root-page redirect. Both were independently reproduced on the untouched production commit.
- TypeScript, lint and production builds passed. Hosted preflight returned `ready: true` for active flows and all four connected mailboxes. Local SMTP probes failed from this machine; the hosted probes and actual hosted SMTP/IMAP receipt succeeded.
- Supabase migration `20261111012746_workflow_reliability.sql` is applied. Workspace RLS remains in force. Security/health advisors showed no new security issue; pre-existing workspace-invitation policy and unrelated performance notices remain outside this change.
- Production logs on the final deployment show successful minute intake, workflow and delivery workers. No error/fatal logs were returned for the sampled final-deployment window. This is a short observation window, not proof about future traffic or the preceding seven days.
- Computer-use visual verification was blocked because the tool could not identify the current browser URL reliably. API, database, provider, build and delivery checks were completed; a visual UI check is not claimed.
- External SMTP acceptance is not an atomic transaction with the database. Ambiguous submission therefore requires Sent-folder review rather than automatic replay. Temporary provider failures can still occur; preparation retries and explicit recovery make them visible and recoverable.
- The Vercel notice's 1,384 timeouts were project-wide. This repair addresses the confirmed workflow defects and function-lifetime coupling; attribution of every historical project timeout remains unproven.
- Saved segment labels remain labels. Existing manually selected company lists were not converted into guessed geography or product rules.

## Product comparison

[Klaviyo's flow analytics](https://help.klaviyo.com/hc/en-us/articles/115002779351) distinguish waiting, review, delivery and skipped recipients, document skipped reasons, and recheck flow/message filters before sending. [Mailchimp's flow controls](https://mailchimp.com/help/edit-customer-journey-map/) explain pause/resume, active-flow editing and recipient controls. Those documented product behaviors informed the final send checks, visible outcomes and individual-run controls. Their private execution infrastructure is not established by these public sources.

[Vercel documents finite Function duration and durable Workflows](https://vercel.com/docs/functions/limitations). This release retains the existing persisted CRM run engine and builder, with smaller bounded jobs and saved action cursors; it does not install the Workflow SDK or claim that increasing a timeout alone fixes business logic.
