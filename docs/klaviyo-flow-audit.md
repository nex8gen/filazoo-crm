# Klaviyo flow inspection and Filazoo B2B requirements

Inspected in Safari on 2026-10-29. Reference draft: `Codex Flow Feature Audit` (`WQ3yDt`). A configured email in the existing F9 draft was inspected without editing its content or sending it. Findings marked **UI** were opened in the account; **Docs** means official documentation was used where account setup prevented further inspection. This inventory is not a claim of implementation parity.

## Builder and creation

- **UI:** template library and blank-flow creation; blank flow asks for a name and tags. Trigger chooser separates recommendations, account metrics, and all trigger families.
- **UI:** trigger families include list entry, segment entry, event/metric, date property, price decrease, and low inventory. The account's metrics include website activity, form/list subscriptions, cart/checkout, order, refund/cancellation, and shipping milestones.
- **UI:** event trigger configuration separates event filters, profile filters, and re-entry. Re-entry can be prohibited, allowed on each qualifying event, or delayed by a minimum period. The chosen trigger is confirmed before building.
- **UI:** sidebar groups actions into messages, data, and logic. Actions can be dragged or inserted using a connector's plus button. A selected action opens a details panel with its own name/settings/status. The canvas has pan, zoom, fit/return, minimap, node menus, and joins.
- **UI:** top-level controls include preview, audit, analytics, history, alerts, status update, flow options, and adding past profiles. These are separate tools; an outline of action labels is not a journey preview.

## Every action in the account's palette

| Action | Inspected settings and behavior | B2B CRM equivalent / gap |
| --- | --- | --- |
| Email | **UI:** internal name; action status; subject/personalization; preview text; sender name/address; independent reply-to; CC/BCC; templates; plain-text or custom-HTML content; desktop/mobile rendered content; content A/B test; recent-recipient frequency skip; UTM with custom parameter option; additional recipient rules; performance and recipient-report link. | Existing template and AI email actions cover part of this. Message rendering, per-action testing, filter evaluation, and branch-aware resolution need explicit verification. Manual review, A/B allocation, sender overrides, CC/BCC, and custom UTM are separate gaps. |
| Text message | **UI:** name/status, content editor, Smart Sending across campaigns/flows, UTM, quiet hours, additional filters, performance and A/B test. Editor has personalization, emoji, link shortening, country selection, attachments, iOS/Android render, and message add-ons. | No CRM SMS flow action. CRM messaging integration is not equivalent to a configured SMS flow sender. Account's country chooser had no options, so full test preview could not continue. |
| WhatsApp | **UI:** action exists but opens WhatsApp setup because the account is not connected. **Docs:** connected business account, channel consent, approved templates, message content, frequency settings, and status are required. | Existing conversation replies do not establish marketing-template/consent automation. Requires a channel-specific action and eligibility model. |
| Form | **UI:** name/status, web versus in-app channel, separate email/phone destination lists. In-app option requires push setup. **Docs:** form/template editor, display/targeting rules and expiration. Reaching this action grants eligibility to see a form; it does not wait for submission. | Adapt as a B2B information-request/form journey only after defining the actual website/portal delivery surface and submission event. It must not be presented as an email send. |
| Customer Hub block | **UI:** action exists but account opens Hub setup. **Docs:** internal name, heading and paragraph; only identified profiles reaching the step see the block; default eligibility lasts 30 days; edits live in the originating flow. | Requires an identified B2B portal surface. Existing invoice access pages are not a general customer-content hub. |
| Property update | **UI:** action status; multiple ordered operations; add/reorder operations; update an existing property, create a property, or remove one; property selector and typed value. | Existing company status/segment/pipeline update is a narrow subset. Arbitrary custom properties require a supported CRM field model. |
| List update | **UI:** action name/status; add or remove membership; list selector. Adding can trigger flows connected to the destination list. | Adapt to saved manual CRM audiences. Dynamic segment rules must not be overwritten as if they were manual membership. |
| Internal alert | **UI:** name/status, up to five email recipients, opt-in notice, sender/reply-to, subject, rich message, personalization/event variables; preview with a recent event; direct render or email test; optional JSON sample values. | Current owner/team in-app or email alert is useful but lacks the full content/recipient editor and its preview. |
| Webhook | **UI:** opening the action is blocked by the account's MFA requirement. **Docs:** HTTPS POST endpoint, custom headers, JSON body, profile/event variables, preview variables, HTTP status reporting, retryable-error backoff and failed/skipped reporting. | Not implemented in Filazoo flows. Needs real endpoint validation, protected credentials, bounded HTTP execution, retries, and delivery logs; a decorative node is insufficient. |
| Time delay | **UI:** amount, minutes/hours/days, optional clock time and timezone, optional selected weekdays. **Docs:** fixed-time day waits use calendar days; profile timezone falls back to account timezone. Wait before a split determines when its conditions are evaluated. | Existing UTC waits/business-day options cover part. Recipient timezone and arbitrary weekday selection remain distinct requirements. |
| Split | **UI:** name, last-30-day waiting/entered statistics, up to 20 ordered paths, editable path names/rules, final fallback, path actions and flip for two branches. Rules offer profile/event conditions, list membership, engagement, random allocation, typed properties, AND/OR, and comparison operators. **Docs:** independent full-size action chains, join/disconnect paths, ordering constraints, and insertion moves downstream actions onto the first branch. | The earlier compact two-column box is not equivalent. Branches need independent action controls and explicit continuation. Nested action selection, preview and email tests must resolve the actual action, not a top-level numeric position. |

## Flow preview: observed interaction

1. Preview switches the builder to a read-only mode and presents searchable sample profiles.
2. Profile cards show whether the person would enter. Selecting one opens a chronological journey alongside the canvas.
3. The entry row has a details view for trigger/event, filters, and re-entry. The inspected profile showed the event timestamp and the configured re-entry policy.
4. The timeline identifies the chosen split path, actions reached and the exit. Clicking a timeline action centers it on the canvas.
5. Exit preview returns to editing. Preview itself does not activate the flow.

Official preview articles are not completely consistent about supported trigger families and old trigger-preview limitations. The account's current whole-flow preview visibly evaluated a split and showed the resulting action. Treat the observed current UI as evidence for this account, and document assumptions about future behavior rather than implying prediction of future replies/opens.

## Message preview and tests: observed interaction

- Configured email details render personalized content and offer desktop/mobile display.
- The custom-HTML editor has code, rendered, and split panes plus formatting/image/data-feed tools.
- Preview opens sample event selection (up to ten recent events), the associated profile, timestamp, and expandable event properties. Property names expose personalization variables.
- Preview can render directly or send to explicit comma-separated test addresses. Advanced settings accept JSON placeholder values.
- Direct preview was executed: profile name and order line items rendered from the chosen event; product links and amounts appeared in the rendered result. No email was sent.
- SMS preview validates content and sending-country setup. A draft message was entered for inspection, but the account had no sending countries to select. Its content editor still exposed platform, attachment, link and identification/opt-out settings.
- **Docs:** manual action mode schedules real recipients and places eligible messages in a review queue instead of automatically sending them. This is a third workflow, distinct from preview and test sends.

## Management, reporting and launch review: observed interaction

- Flow options expose editable metadata, copying the flow ID, and product feedback.
- History is searchable and can be filtered by the affected item, activity, user and date range. Entries identify the actor/time and show old/new values for configuration changes.
- Alerts have active/dismissed tabs and action-specific setup links. The audit draft surfaced missing sender setup, unconfigured actions, and a missing message link; these are separate from performance metrics.
- Analytics can be toggled directly on the canvas. Split/path cards show waiting/entered counts and proportions. Date selection includes current/previous periods and custom ranges.
- Launch review links to profile preview, has an overall action-status choice, and supports immediate or scheduled changes. Blocking setup alerts can prevent activation. The inspected draft was not activated or scheduled.

## Filazoo problems confirmed by inspection/code tracing

1. Current flow Preview is only a label list, with an activation button. It has no selected customer, eligibility explanation, branch trace, or wait timeline.
2. Email testing defaults to actual delivery and assumes filters match. Scenario facts cannot be set.
3. Nested split actions are flattened during simulation but preview/delivery code looks them up using top-level step numbers. This can select the wrong action or fail.
4. Resource validation only checks top-level steps, missing nested mailboxes, assignees and product requirements.
5. The compact split groups branch actions into small cards with no direct per-branch insert/selection controls; it does not match the inspected interaction.
6. Several account-gated channels need actual provider and portal capabilities before they can be represented as working actions.

## Implementation and verification from this audit

Implemented in this working tree:

- Separate full-size branch chains with connector insertion controls, direct action selection, editing, duplication, reordering and removal; shared continuation is explicit.
- Multiple AND/OR rules, positive/negative boolean conditions, text operators, missing-value checks, numeric fit-score comparisons, ordered paths and two-path action flipping.
- Read-only journey preview with saved-customer search, scenario facts, entry/re-entry check details, branch highlighting, path evaluation details, timestamps, and timeline-to-canvas focus.
- Per-message preview/test entry points, desktop/mobile content presentation, scenario facts for email tests, and preview as the default mode.
- Stable source addresses for actions inside branches, used by message previews and actual-delivery test planning; nested resource validation now includes mailboxes/products/assignees.
- Duplicating a split regenerates path/action identities so selection and tracking do not point at the original branch. Message tests opened from a journey preserve its scenario facts.
- Message-level conditions and owner-scoped recent-email frequency skipping. Profile/message filters are rechecked before sending; a failed filter skips the message while subsequent CRM actions continue.
- Preview/message-test panels load on demand. The translation catalog also loads when Chinese is selected rather than being included in every English page's initial scripts. The common shell fell from 421,751 to 335,489 gzip bytes; all 11 monitored routes now pass the 420,000-byte budget (the untouched baseline already failed it on four routes).
- The live database action constraint was missing the two newly introduced action types. Migration `20261029115320_flow_split_actions` is applied. A transactional draft save/readback returned both `split` and `update_company`; the disposable transaction was rolled back.

Browser verification on the local QA page: independent branch chains render; preview disables editing; US/fit-8 routes to the high-fit path; GB routes to the fallback; each timeline includes that path's own waits/actions and the shared continuation. Existing production CRM sample-email preview was also run successfully and produced personalized text plus catalog attachment metadata without sending email.

Final production-build check in Chrome on local port 3001: the two branches render; Chinese loads on selection and English restores; the deferred journey panel opens read-only; the GB scenario selects Everyone else; its selected-message dialog opens with real sending unchecked and retains GB. Safari previously passed the scenario/canvas interactions, but the final production-build check displayed an empty page despite successful asset responses. Its inspector then became unresponsive to computer-use calls. Final Safari sign-off remains unresolved; Chrome success is not a substitute for that check.

Remaining gaps are not implemented: nested split nodes, arbitrary joins/disconnects, manual message-review queues, content A/B tests and random split allocation, custom HTML/template authoring, sender overrides and CC/BCC, custom UTM parameters, recipient-timezone scheduling/arbitrary weekday restrictions, automatic list membership actions, webhooks, SMS/WhatsApp flow delivery, form eligibility and portal content blocks. These require additional runtime/UI work; channel/portal actions additionally depend on their actual delivery capabilities. No full-parity claim is made.

The local environment does not provide a Supabase server secret, so the live-database/SMTP-intercept verification script cannot initialize its client here. Database save compatibility was checked through the connected database; service/API behavior is covered with intercepted dependencies. A real external test email has not been sent in this audit.

Final automated verification: **849 tests passed, 0 failed**; ESLint, TypeScript, production build and client bundle budgets passed. The first build stopped at Next.js's dependency security reminder; its documented retry completed successfully, retaining the upgrade warning. Next.js 16.4.0 still needs a security upgrade. These code changes have not been deployed.

## Verification plan

| Area | Required cases | Verification |
| --- | --- | --- |
| Entry | Matching/nonmatching company, selected contact, missing contact/company, re-entry denied/cooldown, invalid event | Service tests and UI profile preview |
| Split | First match, multiple matches, fallback, empty branch, independent branch actions, reorder/flip, continuation/stop | Engine/runtime tests and canvas interaction |
| Rules | AND/OR, positive/negative comparisons, absent property, numeric bounds, engagement true/false | Engine tests and rule editor |
| Messages | Selected branch content, personalized subject/body, attachments, actual mailbox, preview without mutation, bounded real test | Service tests, rendered UI, explicit test delivery |
| Delays | Units, weekends, calendar-day clock time, deferred send, resume without duplicate actions | Engine/runtime tests |
| Failures | Missing sender/products/assignee, malformed config, provider error, cancelled/expired test, concurrent send claims | Service/API tests |
| UI | Full-size branch nodes, direct branch insertion, nested selection/edit/delete, read-only preview, selected path highlight, mobile layout | Browser verification |

## Primary references

- [Whole-flow profile preview](https://help.klaviyo.com/hc/en-us/articles/30325266432539)
- [Trigger preview](https://help.klaviyo.com/hc/en-us/articles/360028374111)
- [Message preview and tests](https://help.klaviyo.com/hc/en-us/articles/115002774972)
- [Trigger/filter behavior](https://help.klaviyo.com/hc/en-us/articles/115002779051)
- [Multi-branch splits](https://help.klaviyo.com/hc/en-us/articles/52369094030235)
- [Joining paths](https://help.klaviyo.com/hc/en-us/articles/360002419512)
- [Delay settings](https://help.klaviyo.com/hc/en-us/articles/115003885212)
- [Forms in flows](https://help.klaviyo.com/hc/en-us/articles/56151369392539)
- [Hub blocks](https://help.klaviyo.com/hc/en-us/articles/57141004423195)
- [WhatsApp in flows](https://help.klaviyo.com/hc/en-us/articles/40116763040411)
- [Webhook configuration and retry behavior](https://developers.klaviyo.com/en/docs/how_to_add_a_webhook_action_to_a_flow)
