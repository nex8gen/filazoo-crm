# Workflow redesign and verification — 30 October 2026

The workflow system now has guided starters, recursive branches and a scenario-testing workspace. Changes are in the local working tree; they have not been promoted to the published site.

## Reference patterns

The design uses three established patterns: start with a named customer journey, inspect the path a sample customer takes, and test real delivery to a separate test inbox. These are supported by [HubSpot workflow testing](https://knowledge.hubspot.com/workflows/test-your-workflow), [Klaviyo journey previews](https://help.klaviyo.com/hc/en-us/articles/30325266432539), [Klaviyo multi-branch splits](https://help.klaviyo.com/hc/en-us/articles/52369094030235), and [Klaviyo message testing](https://help.klaviyo.com/hc/en-us/articles/115005081907). This implementation does not claim feature parity with either product.

## Implemented behavior

- **Create:** eight starters cover inquiries, lead qualification, unanswered outreach, Shopify leads, Meta leads, quotes, segments and buying-interest categories. Each starts as a draft. The segment starter requires an explicit segment selection.
- **Build:** splits can contain splits. Canvas widths account for their descendants. Selection, configuration, duplication, removal and message tests use the original action location at every depth. Action counts include every branch.
- **Drag or insert:** palette actions and existing actions target the specific branch under the pointer, including nested paths and zoomed canvases. Actions can move between paths and the main sequence. The drag overlay no longer obscures hit detection. Path menus use the same capacity/depth checks, and their portal events no longer start canvas panning. Outside drops and Escape preserve the source; self-descendant moves are rejected.
- **Validate:** every nested action is validated. Duplicate action/path identities, excessive nesting and excessive total actions are rejected. Copies receive independent identities throughout their subtrees.
- **Test scenarios:** the generated matrix includes missing fields, comparison values, fit-score boundaries, initial engagement and simulated engagement after waits. Each scenario displays its facts and chronological journey. Coverage reports actions reached and paths reached, and names unvisited paths with their split context.
- **Review:** the pacing audit checks branch interiors and shared continuation. It detects consecutive messages separated only by CRM updates.
- **Deliver:** transient attachment uploads retry at the same operation-specific object path. Only SMTP failures explicitly reported during connection establishment can reconnect once. SMTP DATA, authentication and unknown failures are not automatically resubmitted.
- **Explain failures:** expired Gateway tokens produce a refresh instruction. If Google's location restriction and the fallback both fail, the error preserves both causes.
- **Use on mobile:** scenario selection becomes a compact native selector. Dialogs, metrics and results remain scrollable. The starter and scenario components load on demand.

## Starter journeys

| Starter | Trigger | Main path |
| --- | --- | --- |
| Respond to an inquiry | Email received | AI reply → wait → reply split → end or task |
| Qualify and route leads | New lead | Fit split → qualification update → market split → tasks/alert; fallback introduction → wait → reply split |
| Follow up without a reply | No reply after two days | Reminder → wait → reply split → end or task |
| Welcome Shopify leads | Shopify B2B list entry | Catalog → wait → reply/click split → task or reminder |
| Welcome Meta leads | Meta list entry | Introduction → wait → reply/click split → task or reminder |
| Follow up on a quote | Quote/bulk-order stage | Wait → quote follow-up → wait → reply split |
| Nurture a customer segment | Selected segment entry | Introduction → wait → reply split |
| Respond to buying interest | Category becomes Interested | Urgent task → internal alert |

The no-reply starter sends after its trigger's delay; it does not add another initial two-day wait. Qualification changes company status only, without marking an untouched lead as contacted.

## Verification evidence

- All seven trigger families accept the recursive definitions; all ten action types are included in the combination tests.
- A **2,400-case matrix** exercises every ordered action pair, both outer routes, missing country and all three engagement booleans. Checks include branch isolation, original action identity, chronological scheduling, exit behavior and definition immutability.
- Runtime integration tests execute nested splits, resume from waits, read CRM changes made during a wait, and assert tasks, alerts, category updates and company updates occur once. Their SMTP and AI dependencies are intercepted.
- Browser verification created the qualification starter, selected and edited a deeply nested task, duplicated and removed it, and opened scenario testing. **72 generated scenarios reached 11/11 actions and 6/6 paths.** Desktop and 390-pixel layouts were inspected. See [desktop evidence](audit-evidence/flow-scenario-lab-20261030.png) and [mobile evidence](audit-evidence/flow-scenario-mobile-20261030.png).
- Two real template messages were accepted by SMTP and found in `raul@filazoo.com` over read-only IMAP, including the catalog-template email. Completed test retries did not resend. [Delivery evidence](audit-evidence/flow-live-email-20261030.json) also preserves the earlier AI failure rather than treating the whole run as successful.
- Full-suite verification passed **941 tests, zero failures**, including the additional regression tests. TypeScript, lint, production build and all 11 route bundle budgets passed. The database-backed delivery-service verification also passed with real PDF/storage and intercepted AI/SMTP; its disposable records were removed.
- Browser drag verification covered a palette drop into an empty path, moves between branches, branch-to-root and earlier-root-to-branch moves, nested split insertion, a nested action drop at reduced zoom, Escape cancellation, outside-canvas cancellation, and a visible self-descendant rejection. Branch-menu selection also inserted correctly after repairing portal event handling. See [branch target indicator](audit-evidence/flow-branch-drop-fixed-20261030.png), [nested target indicator](audit-evidence/flow-branch-drop-indicator-20261030.png) and [resulting path actions](audit-evidence/flow-branch-drop-result-20261030.png). Drafts used for browser checks were not saved or activated.

## Local AI diagnosis

The local Gemini value had one extra final character compared with the supplied current key. The local value was corrected without changing the published secret. Both Google's legacy generation endpoint and its current interactions endpoint then reported that the local request location was unsupported.

The same supplied key returned HTTP 200 and `OK` from an ephemeral server in Vercel's `iad1` region. The key therefore works from that region. The local Gateway token was also expired; a newly downloaded token reached Gateway, which required billing setup. No billing or published environment was changed.

After explicit user authorization, the complete nested split → one-minute wait → Gemini reply/catalog → SMTP → inbox test passed in `iad1`. The run completed with one message and an attached catalog PDF, found by exact Message-ID over read-only IMAP. Retrying the completed run did not resend. The temporary sandbox and its files were stopped and removed. See [real AI email evidence](audit-evidence/flow-live-ai-email-20261030.json) and [regional diagnosis evidence](audit-evidence/flow-ai-region-20261030.json). Local generation still receives Google's location restriction; the working key cannot remove that regional restriction.

## Practical limits

- Up to five split levels, 20 paths per split, 25 actions per branch and 500 actions across the definition.
- Scenario generation runs at most 256 cases and explicitly reports truncation. Reaching every path does not establish every possible input combination or future event sequence. Engagement changes are explicit test inputs, not predictions.
- Real test delivery supports at most six email actions and one hour of cumulative scheduling. CRM changes in that particular test mode are simulated; runtime integration tests cover their actual execution logic.
- Arbitrary graph joins/cycles, manual message-review queues, message A/B allocation, arbitrary webhooks, SMS/WhatsApp flow delivery and recipient-timezone scheduling remain outside this implementation.
- SMTP acceptance and inbox receipt are recorded separately. Open/click tracking cannot prove human engagement because of privacy proxies and automated scanners.

## Reproduce

```powershell
node --experimental-strip-types --test tests/*.test.ts
node node_modules/typescript/bin/tsc --noEmit
node node_modules/next/dist/bin/next build
node scripts/audit-client-bundles.mjs
node scripts/check-ai-config.mjs
```

`scripts/verify-flow-email-delivery-test.ts` uses the real database and PDF pipeline with AI and SMTP intercepted. `scripts/verify-flow-live-email.ts` sends real, labeled messages only to the configured workspace mailbox and reuses saved test IDs. The server-region AI script must run in a Google-supported region; its checkpoint prevents duplicate test starts.
