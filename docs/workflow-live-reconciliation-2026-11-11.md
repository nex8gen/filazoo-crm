# Live workflow, lead and incoming-email reconciliation

Read-only investigation on 11 November 2026. Main reconciliation window: 08:40–08:46 Asia/Shanghai. All times below are China time (UTC+8).

This extends and corrects the earlier architecture review. That review relied too heavily on workflow execution records. A run can exist and send successfully while using incomplete customer context; an incoming email can exist in the mailbox without appearing in the workflow's `emails` table. This review compares those sources directly.

## Scope and evidence

- Inspected all five currently live workflow definitions, their full action settings and current audience records.
- Compared the new-lead flow's stored activation timestamp with every later CRM contact and Shopify intake record; checked Meta intake too.
- Compared cached incoming mailbox headers and available message bodies with workflow email projections, contact creation times, delivery records, branch decisions and waits.
- Examined the full interval after each new lead's first automated send, including header references to its sent message IDs, rather than checking only after the latest reminder.
- Distinguished inbound messages from sent copies, removed messages, spam, marketing mail and form-notification emails. Header counts are deduplicated by normalized Message-ID.
- Read current sender selection, AI input construction, segment deletion, mailbox projection and auto-reply worker code.
- No production worker was invoked, no failed run replayed, no live configuration changed and no email sent. Existing database/mailbox records were read only. This audit does not establish inbox placement or inspect attached PDF contents.

## 1. What the five live workflows actually do

| Live workflow | Saved trigger and actions | Actual audience / result |
| --- | --- | --- |
| 新线索AI首次回复及5小时提醒 | New CRM contact after activation → AI first email with catalog → wait five hours → if customer replied, stop → otherwise one AI reminder without catalog → stop. No re-entry. | Activated **Nov 10 at 14:39:04**. Four qualifying contacts, four runs, six recorded sends. Two runs completed; two waits were in the future at inspection. |
| 精选优质客户（巴西及欧美） auto workflow | Saved-segment membership → catalog email during 09:00–17:00 UTC. No re-entry. | The audience is an explicit list containing **3D beyond layers only**. It has no geographic rule. One run and one send. Created Nov 9 at 17:23; first enrollment 17:24. |
| 需要跟进 auto workflow | Saved-segment membership → quotation follow-up email during 09:00–17:00 UTC. | The referenced segment **does not exist now**, although the flow remains live. Two runs, for zw casting and KingTon, both skipped their email and completed. Created Nov 10 at 10:56; first enrollment 10:57. |
| 跟进 auto workflow | Saved-segment membership → email using the `send_catalog` template/attachment behavior and custom quotation-follow-up body. Business-hour sending; no re-entry. | Explicit audience: **KingTon only**. One failed run; zero sends. Created Nov 10 at 11:12; first enrollment 11:13. |
| PETG-CF auto workflow | Saved-segment membership → static `quote_follow_up` email. Business-hour sending; no re-entry. | Explicit audience: **KingTon only**. No product-interest event or PETG-CF condition. One failed run; zero sends. Created Nov 10 at 15:49; first enrollment 15:50. |

The four segment workflows do not store a dedicated activation timestamp. Their creation times and earliest enrolled runs establish the available historical boundary; the exact activation/change history cannot be reconstructed from a missing audit trail. The new-lead flow does store an exact activation boundary.

Audience names are labels. The current saved rules are three manual company lists and one missing segment. New Brazilian/European leads or new PETG-CF inquiries are not automatically added merely because their details match a segment's name.

## 2. Every lead received after the new-lead flow was activated

There were **four Shopify intake records and four newly created contacts** after Nov 10 at 14:39:04. All four intake records were processed successfully and all four contacts enrolled. No later Meta intake was present. No missing new-contact enrollment was found in this window.

| Customer / company | Contact created | First automated email | Reminder / saved next step | Assigned salesperson |
| --- | --- | --- | --- | --- |
| Jessica — 718 Recreation Center | Nov 10, 20:37:49 | Nov 10, 20:38:08 | Reminder Nov 11, 01:39:09; completed | Terrianne |
| Nathália — E&D filamentos | Nov 11, 00:41:01 | Nov 11, 00:41:22 | Reminder Nov 11, 05:42:09; completed | Enphany |
| Willian — Clyc Mkt | Nov 11, 03:53:20 | Nov 11, 03:53:40 | Scheduled Nov 11, 08:53:41; active at inspection | Asher |
| Edmar — Edmar | Nov 11, 07:00:26 | Nov 11, 07:01:24 | Scheduled Nov 11, 12:01:24; active at inspection | Terrianne |

The recorded first sends occurred about 19, 22, 20 and 58 seconds after contact creation. Both completed reminders occurred approximately five hours and one minute after their first emails. Catalog attachment records exist for the four first emails; the two reminders have no attachment records.

No customer reply was found in the cached inbound messages after any of these four first automated sends, whether matched by sender address or references to their outgoing Message-IDs. The two recorded `customer_replied` decisions were false, consistent with that evidence. This does not establish that reply detection works in general; the Bonita case below demonstrates a real ingestion gap.

Four earlier Shopify forms received after the oldest segment flow was created were Ethos automação, A2 Global Partners, Arthur Modesto and 3D.Senior Inc. Their contacts predate the new-lead flow's activation. They do not qualify under its saved activation rule, and the older segment workflows do not cover arbitrary new leads.

## 3. The AI first reply ignores the form that created the lead — confirmed live defect

E&D's saved form contains:

- Materials: PLA and PETG.
- A detailed list of requested colors.
- Estimated monthly volume: **500–999 kg**.

The first automated email, sent at 00:41:22, instead asks which materials, colors and quantities the customer wants. Its five-hour reminder repeats that request. It does not use the supplied requirements.

The cause is visible in `lib/data/flow-ai-reply.ts:35`: preparation loads CRM `emails`, basic contact/company fields, the workflow owner's name and products. It never reads `shopify_leads.form_content`, the raw form, the saved inquiry event or the lead-inquiry origin. The new-lead run also does not save the specific intake record ID in its context. At the first send these contacts have no CRM email conversation, so generation receives an empty history and falls back to a generic introduction.

The separate inbox has a form-to-inquiry representation in `lib/lead-inquiries.ts:9`, but this workflow preparation path does not consume it. The UI can show the customer's form while the AI runner cannot see it.

Willian's form states under 50 kg/month, but his first email asks for quantities again. Edmar's saved range is 200–499 kg/month and is also omitted from the available AI input. These ranges should inform a response without being mistaken for an exact order quantity.

**Required repair:** bind the run to its originating submission and include a typed inquiry context—requirements, volume range and source—when generating both the first reply and reminder. Preserve the source rather than fabricating an SMTP email. Test the actual form → prompt → generated reply path.

## 4. Incoming mail after activation is a separate, uncovered path

After the new-lead activation boundary, the four inbox caches contain **23 distinct inbound inbox messages**, plus two advertising-folder messages and one spam-folder message. The inbox set includes:

| Category | Messages | Workflow interpretation |
| --- | ---: | --- |
| Messages from existing CRM contacts | 5 | None is projected into the workflow `emails` table. Contacts predate the new-lead activation. |
| Shopify notification emails for the four captured forms | 4 | The four forms were captured separately and enrolled successfully. These notifications are not four additional leads. |
| Alibaba inquiry notifications | 6 | Relay senders/Reply-To addresses need an explicit integration and identity policy. They are not automatically CRM contacts. |
| Other apparent customer inquiries/replies without a matching CRM contact | 3 | Includes the Denmark 100 kg inquiry, a PETG quotation reply and a Palmetto reply. Header evidence identifies likely business messages; bodies were not all cached. |
| Other inbox messages | 5 | Account notices/marketing. Their existence does not imply a workflow should send. |

All four INBOX snapshots were freshly synchronized around 08:46:04, with no saved sync error. The missing projection is therefore distinct from failing to download mailbox headers.

The five known-contact messages are:

| Customer | Received | Actual request | Mailbox | Workflow projection |
| --- | --- | --- | --- | --- |
| Bonita — KingTon | Nov 10, 15:40:08 | Quote for 250 pieces of black PLA matte | Raul | Missing |
| Alex — 3D Lamp Business | Nov 10, 16:08:01 | Color-cycle length for translucent PLA; says earlier website attempts did not receive a response | Raul | Missing |
| Alex — 3D Lamp Business | Nov 10, 16:14:27 | Follow-up on the same product question | Raul | Missing |
| A2 Global Partners | Nov 10, 21:00:07 | Formal 50 kg starter-order quotation with shipping and commercial details | Terrianne | Missing |
| Hook it & book it | Nov 11, 00:03:52 | Warehouse location / pickup to save shipping | Terrianne | Missing |

None of the five live flows has an `email_received` trigger. The new-lead flow runs for new contacts and stops after a reply or its one reminder. It does not start another reply workflow when an established customer emails again.

Consequently, there are two separate issues: incoming customer data is not reaching workflow facts, and the saved automations do not define general handling of those incoming messages. A repaired scheduler alone cannot supply a missing business rule.

## 5. Bonita's real emails explain why the earlier verification diagnosis was incomplete

Both failed segment runs target **the same contact, Bonita at KingTon**, rather than two unrelated contacts.

| Time on Nov 10 | Evidence |
| --- | --- |
| 11:13 | 跟进 workflow enrolls Bonita and waits for the send window. |
| 15:40:08 | Actual inbound email requests 250 pieces of black PLA matte. It is in Raul's mailbox cache and has a cached body. |
| 15:41:53 | Raul's recorded manual reply quotes PLA matte at $4.55. |
| 15:50 | PETG-CF workflow enrolls the same contact and waits for the send window. |
| 17:00 | Both segment workflows fail with `Address is not verified`. |

`loadFlowFacts` and the inquiry-response exception read the CRM `emails` table. That table has **zero inbound rows for Bonita**, even though the actual mailbox contains multiple inbound messages, including the quote request above. The unverified-address rejection reflects missing inquiry evidence in the runner's data source.

For the earlier 跟进 journey, her 15:40 message occurs after entry. With that message projected into the workspace mailbox scope, the saved `stopOnReply=true` rule should cancel this follow-up. For the later PETG-CF journey, the same inbound message predates entry but should still count as inquiry evidence for recipient policy. A separate already-replied guard is also needed to avoid unnecessary automation after a teammate's manual response.

This is an observed customer case linking the ingestion gap to wrong workflow decisions. Simply verifying the address and restarting both runs would not resolve the underlying logic or decide whether either follow-up is still appropriate.

## 6. Two independent ingestion restrictions need attention

The existing budget defect remains: three workspaces yield a 60-second workflow slice, while `syncFlowMailboxMessages` returns unless at least 95 seconds remain. See `app/api/cron/flows/route.ts:19` and `lib/data/flow-mail-sync.ts:15`.

There is also a distinct ownership restriction at `lib/data/flow-mail-sync.ts:77`: a personal mailbox is excluded unless its owner owns a live flow. All five live flows belong to Raul. Terrianne, Enphany and Asher own none. Therefore, even after correcting the time budget, this path still excludes Terrianne's A2/Hook replies. Additionally, flow facts select only shared mail or the flow owner's mail.

**Required design:** make mail ingestion independent of whether someone has authored a workflow, preserve mailbox ownership, and explicitly authorize which flows may consume which customer conversations. Do not fix this by indiscriminately giving every flow access to teammates' private mail.

## 7. A live workflow has an invalid dependency — confirmed

`需要跟进 auto workflow` references saved segment `8b3cd1d8-8b44-486d-a426-30df3d9e0130`, which no longer exists. The flow is still live.

The scanner returns no members for a missing segment (`lib/data/flow-runtime.ts:116`). Send-time membership filters also fail. The existing runs contain only a generic filter-skip reason. The deletion time is not recorded in the inspected data, so the exact historical deletion-versus-rule-change sequence is unverified; its current broken state is certain.

`app/segment-actions.ts:32` deletes a saved segment without preventing deletion while live flows depend on it or updating those flows' status. Activation resource checks validate a segment when enabling/saving, but do not keep the dependency valid afterward.

**Required repair:** show a blocked dependency immediately, protect or explicitly resolve deletion, and provide an operator decision about the waiting/previously skipped journeys. Do not silently substitute a broader audience.

## 8. Assigned salesperson and automated sender are different

All four new-lead first emails were sent from **Raul's mailbox**, signed as Raul. Their assigned salespeople are Terrianne, Enphany or Asher, as shown in the lead table.

This matches the saved `mailboxId='default'`: `lib/flow-mailboxes.ts` resolves the workflow owner's available default, and `prepareFlowAiReply` loads that same owner's display name and product view. It does not dynamically use the company's pipeline owner.

This is a concrete routing behavior requiring a product decision. If the intended journey is assigned-representative outreach, the current configuration cannot express that behavior. It also affects where customer replies arrive, which sender's history is available, and the continuity of manual follow-up. Retain the central sender if that is intended; otherwise introduce an explicit assigned-representative option with consistent mailbox, signature and permissions.

## 9. The separate conversation automation is also not generally running

There are four saved conversation auto-replies: three are paused, and one is enabled but in `needs_review` with `canceling statement due to statement timeout`. It has no recorded `last_sent_at`.

The worker selects `active`, `ready` and `waiting_shipping` states, so `enabled=true` alone does not make the needs-review record execute. That record concerns another contact and does not supply coverage for the new incoming cases above. A database statement timeout is a separate failure class from a Vercel function execution timeout.

## Priority changes based on actual journeys

1. Repair bounded mailbox projection and clearly show its freshness. Preserve conversation ownership and authorize consumption explicitly.
2. Carry each form's actual inquiry into the AI context. Verify E&D's materials/colors/volume are respected in a controlled test.
3. Surface and resolve the missing segment dependency; keep policy skips and business completion distinguishable.
4. Define incoming-customer handling separately from first-contact onboarding. Specify who owns replies, when AI may answer, when a person takes over, and when a follow-up must stop.
5. Decide central versus assigned-representative sending and use the same identity consistently for mailbox, signature and context.
6. Reconcile Bonita's already-handled quotation and historical failed runs before any replay. Maintain action receipts and final pre-send checks from the architecture review.

No production action was taken as part of this investigation. The next verification should exercise an actual form payload, a controlled incoming reply, salesperson routing, segment deletion, and safe recovery end to end—not only a green simulated run.
