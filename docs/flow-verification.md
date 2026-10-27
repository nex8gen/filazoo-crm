# Flow customization verification

Reviewed October 27, 2026. This audit covers the full builder, rather than one example wait duration.

## Triggers

| Trigger | Runtime behavior and coverage |
| --- | --- |
| New lead | Manual, Shopify and Meta intake enroll saved contacts; minute scanning recovers missed intake. Activation/resume boundaries exclude historical contacts. Contact event keys prevent duplicate runs. |
| Email received | Background IMAP synchronization imports messages matching CRM contacts. Only messages after the flow's activation boundary enroll; retries are deduplicated. Copies from the CRM's own sender addresses are excluded. |
| Category changed | Both inbox edits and the Change category action emit category events. Subsequent conditions read saved state; clearing a category does not resurrect the original enrollment category. |
| No reply | Evaluates the latest sent message per contact/thread, the configured hour/day duration and weekend setting, and subsequent authorized replies. Messages from another automation can start a follow-up; a no-reply flow's own sends cannot recursively restart itself. Reads are paginated. |
| Lead added to list | The selector exposes the actual source groups: Shopify B2B leads and Meta ad leads. Intake and recovery share contact membership event keys and activation boundaries. Arbitrary list names without a CRM source are rejected. |
| Company enters segment | Saved CRM segment changes enroll matching flows. Segment, country, company status, pipeline stage and minimum fit score must all match. |
| Pipeline stage changed | Saved CRM stage changes enroll matching flows with the same company filters. |

## Actions and options

| Action | Controls verified |
| --- | --- |
| Wait | Minutes, hours, calendar days, business days, optional resume time, successive waits, pause/resume and stored due timestamps. Business-time minute/hour durations exclude weekends throughout the interval. Execution uses UTC, matching the editor labels and assistant capability guide. |
| If condition | Customer replied, current category, opened email and clicked link; lookback window; matched and unmatched branches; Continue, Skip next and Stop. |
| Send email | All five templates; workspace, owner personal and explicit sender choices; subject/body overrides and first-name substitution; preheader; same/new thread; opens, clicks and UTM switches; stop on customer reply; business hours/any time. The catalog template generates, stores and attaches a real PDF. |
| AI auto-reply | Product information, exact CRM prices and quantities, catalog attachment, first actual message only, instructions, all three language settings, same/new thread, tracking and send window. Tests exercise 144 combinations with synthetic provider responses. Actual provider availability, quota and output remain external dependencies. |
| Create CRM task | Conversation owner/fallback flow owner or a specific active member; title, notes, priority and due date. Recipients can see and complete tasks in Tasks and notifications. |
| Change category | Saves the category while preserving other inbox-state fields, records its reason, updates later conditions, and emits a deduplicated event to matching category flows. |
| Internal alert | Conversation owner/fallback owner or a specific member; message; in-app/email delivery; optional conversation link. Recipients can read their alerts in Tasks and notifications. Email-alert activation validates the default SMTP mailbox. |
| Stop | Saves the reason and completed/cancelled outcome; later actions do not run. |

## Persistence and operational checks

- Draft/live/paused state, create/edit/delete/duplicate/bulk controls and role restrictions are covered by the flow visibility, agent, API and canvas test suites.
- Existing runs retain their enrolled definition when a live flow is edited. Atomic run claims prevent concurrent workers from delivering the same action twice. One unreadable run does not prevent other due runs from executing.
- The Supabase scheduler separately calls the wait-resume and inbox worker every minute. Vercel's daily tick remains a backup. Polling and AI/SMTP processing introduce latency beyond an exact due timestamp.
- Website/Meta inquiries and received customer emails do not require a third-party address verification result. The contact's verification label is preserved. Unsubscribe, suppression, invalid/risky address and daily send limits still apply; unrelated cold outreach retains its verification requirement.
- Tasks and alerts are read and updated only for the signed-in recipient. Their list views show up to 100 items; the header summary counts all pending items.
- Incoming messages still need a saved CRM contact and must match the selected flow filters. This work does not automatically turn unknown mail senders into contacts.

## Evidence and limits

Relevant suites: `tests/flow-runtime.test.ts`, `tests/flows.test.ts`, `tests/flow-ai-options.test.ts`, `tests/flow-ai-reply.test.ts`, `tests/flow-activity.test.ts`, `tests/flow-email-test.test.ts`, `tests/flow-email-delivery-test.test.ts`, `tests/flow-visibility.test.ts`, and `tests/flow-canvas.test.ts`.

Full tests, lint, TypeScript and production builds are checked for release. SMTP/IMAP authentication and actual minute scheduler HTTP responses are checked separately. Automated sending tests intercept SMTP and AI calls; they do not prove recipient inbox delivery or placement. Real email testing and previews using existing customer data require the approval requested in the conversation; neither rejected test was executed. No production customer records are manufactured for this audit.

Open/click detection is limited by image loading, privacy proxies and link scanners. AI model, SMTP provider and recipient mailbox behavior can fail outside the application; run Insights must be checked for delivery errors.
