# Workspace chat and agent

## Saved conversations and usage

Chat, Agent and customer AI conversations save to Supabase after every completed
reply. **History** searches titles and messages and supports rename, pin/unpin,
archive/restore and permanent transcript deletion. It shows the current page,
record and mode only. The latest nonarchived conversation resumes on reload;
**New chat** preserves the earlier transcript. Messages and lists are paginated.

The authenticated server owns transcripts. Reads recheck current membership,
original role, selected-record access and a fingerprint of accessible mailboxes
and sales assignments. A role, mailbox-access or assignment change makes earlier
histories unavailable, including
email evidence discovered away from an open record. Browser clients cannot read
or write these private tables/RPCs directly. Histories are private to their owner.

Agent proposals link to their conversation. Reopening history reads current
approval, status and results; it never approves or executes proposals. Existing
expiration, role, snapshot and execution-lock checks still apply. Transcript
deletion preserves action audit records and aggregate usage. Saved requests ignore
client-supplied past messages/results. Version checks reject stale tabs; request
IDs replay completed responses without another provider call or new proposals.
For an unknown request outcome, reopen History before trying again. Start a new
conversation if a crashed request remains pending.

Long conversations use the most recent ten saved messages plus the question and
a bounded rolling summary of attributed earlier excerpts. This extractive memory
is not a verified customer profile or permanent agent instructions. Current CRM
records and execution results take precedence. Full transcript text remains
available through pagination. Image names are saved, but image bytes are not
retained; reattach an image to inspect it again.

**History → AI usage** shows the owner's last 30 days of saved-chat requests,
provider calls (including research/lookups and failed attempts), reported token
counts, missing-counter coverage and estimated USD cost. Optional
`AI_CHAT_MODEL_RATES_JSON` sets input/output prices per million tokens per model.
Costs are unavailable without configured rates. Estimates exclude cache discounts,
search fees and other billing adjustments, and are not provider invoices or usage
for unrelated automations.

Apply the additive `ai_chat_history` migration for the private tables, RPCs and
action links. No paid Supabase plan is required. `tests/chat-history.test.ts`
checks API boundaries, usage and memory. `tests/chat-history-database.sql` checks
transactional completion, ownership, stale requests, search, deletion and database
privileges with all test data rolled back.

## Chat and agent behavior

Chat is read-only. The assistant route discards action output in chat mode and never creates proposals for it.

The sidebar captures the open email and mailbox, Messenger conversation, or flow editor when a request is submitted. Chat also reloads selected records for accurate replies and summaries, while keeping actions disabled. Each mailbox/conversation/flow has its own sidebar history. Source emails are reloaded through accessible mailboxes again at approval and execution; replies retain the selected sender mailbox and threading. Unavailable invoice defaults, payment settings or older message bodies are reported as coverage limits rather than blocking an otherwise accessible selected email. A failed selected-message read still blocks the request.

For Messenger, “write a reply to this message” prepares a `draft_message` action using an actual inbound database message ID. Approval fills the conversation composer and preserves an existing unsent draft; it never sends. An explicit send request continues to use `send_message`. For flows, context includes the saved definition, valid unsaved editor changes and selected step. Existing-flow requests use `update_flow`; the editor refreshes after approval only if it still matches the request snapshot or an unchanged saved definition. Newer local edits remain intact. Incomplete unsaved definitions require completion before the agent can safely edit them.

Agent mode reads the selected email conversation, company or invoice, billing defaults, current product variants and quantity prices, current saved payment methods, legacy bank accounts, and its previous action results. Email selection is sent as an identifier; the server reloads the accessible conversation, full message bodies and customer profile. Exact contact addresses, including secondary contacts, identify the company. Ambiguous matches require clarification. Each open record has its own sidebar conversation; recent execution results remain available across page navigation.

Supported actions include creating companies, updating existing customer/contact, pipeline, billing and shipping fields, appending customer notes, creating and updating catalog-based draft invoices, and drafting or sending emails. Invoice creation uses saved customer defaults and can carry explicit billing, shipping and PO references from email into its document. Customer updates preserve omitted fields and reject changed profile snapshots. The agent can fill existing fields; additional information without a supported field can be appended as a note. It does not create new database fields. The expanded tools below also support custom-price invoices, saved purchase orders, invoice issuance and recording received payments when explicitly requested and permitted by the current user's role.

For requests such as “check customer emails and add any supplied shipping address to the profile,” Agent mode can look up accessible synced inbound emails without an open conversation. Read requests run before mutation proposals and retain the original task, with up to two lookups of eight messages each, optional customer/message filters, a literal search phrase and pagination. Full available bodies and uniquely matched customer profiles are returned to the model; missing bodies, truncated text, pagination and mailbox errors are reported as coverage limits. Search does not initiate a mailbox sync or promise ongoing monitoring. It does not treat a preview or failed read as proof that information is missing.

Email-derived profile changes and notes carry `sourceEmailId`. Preparation and execution recheck access, inbound direction and an exact unique sender/contact match to the target customer, including secondary contacts. Instructions select the latest explicit customer correction, map shipping details to shipping fields, retain billing and primary-contact fields, and skip missing or already matching values. Existing manual/auto approval rules still govern writes. Email text is evidence and cannot authorize additional actions.

Profile edits use `updateCompanyFields` and the server-only `patch_company_profile_fields` RPC. Only supplied fields are validated and changed; an imported customer's missing country/segment or invalid unrelated legacy field does not block shipping, billing, contact or pipeline updates. All tables and the activity event save in one transaction. Every existing editable profile field is supported, and unknown fields remain rejected. Apply `20261027101004_patch_company_profile_fields.sql` before running this version against another database. `tests/company-profile-fields-database.sql` checks every field, preservation, authorization and failure rollback using synthetic records in a rolled-back transaction.

For requests to complete a profile from an address, `deriveAddressFields:true` can fill an empty country from a clear country suffix, including USA/US/United States and UK. Derived changes are added before the approval card is created. Explicit values and conflicting saved countries are preserved; state codes and postal codes alone do not imply a country. Shipping-only requests omit this flag. The model can also map clearly supplied cities, recipient names, phone numbers and other supported information into their actual profile fields without inventing missing details.

Email actions support `delivery: "draft"` or `"send"`. A draft is stored in the user's action result and opens through `/emails?agentDraft=<action-id>` in the inbox composer, with the actual invoice PDF attached when requested. The owner-only draft endpoint rechecks source email access and invoice revision. Draft preparation never requires SMTP and never sends mail. Existing unsent composer content is preserved. Reply recipients and threading headers are resolved from accessible source messages on the server. Invoice/profile pages also load recent customer correspondence so the agent can write relevant messages. Only an explicit send request should produce a send action. A create/update request can include drafting or sending its invoice email as a second step.

Email actions also accept `email.attachCatalog:true` for the complete active-product catalog PDF, including alongside an invoice. The approval card shows the product count. Preparation snapshots the server's product selection and pricing; execution and draft retrieval recheck that snapshot before generating the real PDF with the shared catalog renderer. Changed catalog details, unavailable products, incomplete reads, rendering failures and oversized PDFs block completion. Specific saved versions or custom subsets still use the inbox catalog picker. The model cannot supply attachment bytes or catalog snapshots. An attachment claim without the catalog flag is rejected. Catalog draft creation needs no SMTP and never sends mail.

Assistant responses validate the action protocol before preparing proposals. Unmarked/malformed internal JSON produces a readable retry message with no actions. Duplicated raw email/action JSON in the summary is replaced with a plain-language status while valid actions retain their approval cards. JSON/code fences and internal protocol markers are never displayed as an email draft.

The model chooses record IDs and quantities. The server constructs invoice documents using saved billing details, catalog prices and payment snapshots. New invoices default to all current payment methods compatible with their currency, including PayPal and bank transfer. Explicit `paymentMethodIds` selects a subset. These snapshots replace the legacy bank block and old payment instructions; a legacy `bankAccountId` is reserved for an explicitly requested legacy account. Execution rechecks that selected payment details have not changed since approval. Missing prices, ambiguous variants, currency conflicts, and quantities below the catalog minimum require clarification. Updating a catalog line preserves its saved tax rate unless an explicit `taxBps` is supplied.

Invoice `details` supports shipping and discount amounts, currency, issue/due dates, reference, notes and billing/shipping addresses. Money is integer cents: a voice-style request such as "shipping cost is 39 doller" produces `shippingMinor: 3900`, which changes the invoice's actual shipping amount and total. Details-only updates omit `items` to preserve all saved lines, including custom or order pricing. Replacing those lines still requires the invoice editor. The agent instructions cover common transcription errors, latest corrections and applying supported information to its actual CRM field.

The `create_flow` action accepts the same validated trigger, filter and ordered step configurations as the flow editor. The model receives a configuration guide generated from those validators and, for flow requests, accessible sender mailbox labels, active member IDs and recent flows belonging to the signed-in user. Mailbox credentials are excluded. Flows default to draft in the instructions; activation requires an explicit request. Execution uses the existing flow service, including resource validation for live flows. The approval card shows the trigger, filters, status and every ordered step; the saved result opens the new flow. The Flows list refreshes after an agent creation without replacing an unsaved editor draft.

## Expanded CRM tools

`crm_action` adds 37 strictly validated operations alongside the eight original actions. Schemas and usage instructions live in `lib/ai/crm-tools.ts` and `lib/ai/crm-productivity.ts`; preparation and execution live in `lib/ai/crm-execution.ts` and `lib/ai/crm-productivity-execution.ts`. The existing provider configuration, invoice builders and email safeguards remain in place. This expands the agent's tools and instructions; approved business facts persist for automatic replies, but this does not fine-tune the underlying model.

| Area | Agent operations |
| --- | --- |
| Customers and sales | Schedule/cancel a follow-up, assign/unassign an owner, delete a company, create a customer catalog |
| Products | Create a product; edit its name, material, sizes, variants, quantity prices, stock, image URL and active status |
| Saved audiences | Look up, create and edit saved segments and their selection rules, separately from customer business-segment labels |
| ERP inventory | Read saved stock, SKU aliases and sync status; explicitly refresh the connected ERP snapshot with admin/operator permission and manual approval |
| Purchase orders | Create an order, partially edit its details or status, create an invoice for remaining quantities at agreed order prices |
| Invoices | Save explicitly agreed custom-price draft lines; issue, void or delete an invoice; record a received payment |
| Existing flows | Edit definitions, activate/pause/return to draft, duplicate as a draft, delete |
| Email and messaging | Change read/star/folder/category/follow-up state; send a reply to an existing Facebook, Instagram or WhatsApp conversation |
| Tasks and alerts | Create your own general task, edit its title/notes/priority/due time/status, complete your assigned task or mark your notification read |
| Exports and downloads | Export selected companies, a saved audience, search matches or all companies as CSV; download a saved invoice or catalog PDF |
| Conversation AI | Inspect accessible automatic-reply statuses, explicitly enable/pause a conversation or approve its waiting shipping amount |
| Approved business knowledge | Inspect reusable facts; admin/operator can add or delete explicitly approved policies with manual review |
| Settings | Change your display name/preferences; manage team members, stop/resume/delete a mailbox connection, change invoice defaults/payment methods within your role |

The agent calls the same authenticated services as the CRM forms. Role and record ownership checks run at preparation and execution. Product/order/flow/preferences changes preserve omitted fields, and approval snapshots reject stale records. Purchase orders retain their version lock; invoice updates retain their revision lock. Custom invoice lines use explicit integer-cent prices, stay drafts, require manual review and cannot detach an order's agreed products. Recording a payment never initiates a charge or bank transfer. Messaging recipients and channels are resolved from real inbound messages. Mailbox passwords, login credentials, authentication, choosing/uploading files and connecting new external accounts remain interactive CRM tasks; the agent directs the user to the appropriate page.

`FILAZOO_CRM_READ_JSON` enables bounded lookups of companies, products (including inactive ones), orders, invoices, full flow definitions, your tasks/notifications, catalogs, messages, member labels, manageable mailboxes, authorized billing settings, conversation AI and business facts. Exact customer-email searches include secondary contacts and preserve ambiguous matches. Exact variant SKUs resolve to their saved parent product, including inactive products; scans explicitly stop beyond 5,000 catalog products. Queries accept literal search text, exact IDs, optional company scope and pagination. Each response includes coverage, and up to four total reads are allowed per request, including at most two existing email lookups. `FILAZOO_CRM_READS_JSON` batches two to four independent CRM lookups concurrently; each still consumes one read. A failed batch produces no proposals. Projections exclude credentials, tokens and raw webhook payloads. Reads finish before proposals are stored; a read failure or budget exhaustion never saves partial mutations. Chat mode still rejects all action/read protocols.

Task edits preserve omitted fields, reject concurrent changes and cannot take over a teammate's task or bypass a shipping-review workflow. CSV downloads require a completed action owned by the current user, expire with its 30-minute approval window and reject changed export data. Exports neutralize spreadsheet formulas, preserve Unicode and stop above 5,000 source companies or 4 MB; selecting specific company IDs avoids scanning the whole company list. Product edits preserve custom descriptions and unrelated tags and reject lost/concurrent saves. File downloads use authenticated CRM endpoints.

Malformed lookup or action output gets one shared, bounded re-planning attempt before any proposal is stored. Action validation feedback contains only schema error codes and paths. Repeated invalid output stops without proposals; this mechanism never retries an executed action.

Conversation AI always requires manual review because enabling it permits future automatic replies. The server resolves receiving mailbox, RFC message headers and recipients from saved emails; the model cannot supply another recipient. Re-enabling preserves an existing shipping review. Shipping approval reports a queued reply, not confirmed delivery. Business-fact changes also require manual review and admin/operator permission. Customer messages and web content cannot approve new workspace policy. Credentials, uploads, integration setup, portal administration and dashboard layout changes still use their CRM interfaces. Newly created IDs can support the next turn, but there is no autonomous post-approval continuation engine.

Examples: “Rename TEST-PLA to Premium PLA and keep its prices”; “Mark PO-42 in production”; “Create an invoice for PO-42's remaining quantities”; “Pause Buyer follow-up”; “Archive this email and keep its star”; “Record the $50 bank transfer received today, reference BANK-42”; “Mark my call-buyer task complete.” Missing identities are looked up rather than fabricated. Tasks requiring a newly created record's ID can continue from its saved result; if that result is not yet available, the agent must finish the first step before preparing dependent work.

## Approval

The agent starts with **Ask for approval**. Each proposal shows the company, products, quantities, unit prices, total, bank details and email text. The user can approve or decline it. **Auto-approve** executes proposals from new requests sequentially; changing the selector never executes older proposals. Auto approval includes sending an explicitly requested email.

Destructive operations, invoice lifecycle/payments, custom invoice prices, member invitations/changes/removal, mailbox changes and shared billing settings always require manual review. Auto execution stops at such a proposal so later actions cannot run ahead of it. New cards show the resolved target and actual resulting details, with money formatted in the relevant currency. All new actions reuse `workspace_agent_actions`; no database migration or new storage is required.

Approval settings live in a small pill at the bottom left of the message composer. Clicking it opens an upward popover with the two approval choices; choosing one closes the popover. While an agent task runs, a collapsible status panel above the composer shows its current operation, target, source page and module icons. Execution stages come from the saved action's progress: checking invoice details, saving a draft, preparing its PDF and sending the email. The authenticated progress endpoint returns only the current user's action status and progress. Planning labels describe request preparation and do not claim an action has already run.

Proposals are stored in `workspace_agent_actions`, owned by the current user and valid for 30 minutes. Execution reloads the stored action, checks membership and approval, and atomically claims a pending proposal. This includes invoice edits and flow creation. Repeated execution returns the saved result; failed or interrupted actions are never automatically retried. Browser roles cannot write this table directly. Apply `20261026062821_workspace_agent_actions.sql` when setting up another database. The new actions use existing tables and require no new migration.

Email uses the user's effective SMTP mailbox and the existing email send/storage workflow. A saved invoice is checkpointed before rendering or sending. If sending fails, the result retains the invoice link. Check Invoices and Sent before requesting another send after an uncertain result.

## Models and configuration

Chat and agent use the existing Gemini connection and model by default. Agent capability comes from its authenticated actions and approval controls. Independent `GEMINI_AGENT_MODEL` / `GEMINI_CHAT_MODEL` overrides are optional; blank values retain the existing email model configuration. The corresponding Gateway overrides are optional too.

The current provider flow tries Gemini and can fall back to Gateway for unsupported locations. Gateway is not required when Gemini works on the published app. The optional Gateway connection needs valid authentication and enabled billing. Local Vercel tokens expire; refresh with `vercel env pull` into an ignored temporary file and preserve local overrides when updating `.env.local`. Do not commit tokens or provider keys. Restart the development server after changing environment settings if Next.js does not reload them.

## Verification

Customer chat and the workspace Chat/Agent composer offer an optional **Web search** toggle, off by default. Enable it and ask to analyze a customer, or use **Analyze customer**. The assistant uses the selected customer's saved name, contact/email, website and location, or identifying details typed in the conversation. In workspace chat, open a customer or matched email to provide a saved identity; otherwise include a company name, email or website in the question.

Research calls Gemini's Google Search and URL context tools using `GEMINI_API_KEY`; `GEMINI_RESEARCH_MODEL` optionally overrides the research model (default `gemini-3.5-flash-lite`). Gateway-only installations retain CRM assistance and show that Google search is unavailable. Research failure never silently becomes a successful web search. No new database migration or search API key is needed.

The report covers company identity, activities, sourced size signals, buying potential, likely filament applications and questions to confirm. Inferred material demand and unknown scale are labeled explicitly. A separate research request contains identity fields and recent user questions, excluding saved email bodies, CRM notes, invoice details and deal values. Its verified public sources and supporting statements are then combined with the authorized CRM context. Source links, research time, access failures and sandboxed Google search suggestions appear below the answer. Research does not save a report or request CRM changes by itself; existing action approvals still apply in Agent mode.

- `npm test` includes invoice construction, email body loading, exact customer matching, reply threading, draft versus send execution, generated PDF attachment bytes, customer field preservation, stale updates, read-only chat enforcement, manual/auto approval, ownership, expiry, declines, concurrent execution and partial failures.
- `tests/agent-crm-tools.test.ts` covers new tool validation, preservation of omitted fields, product/order/custom-invoice builds, financial permissions, ownership, stale snapshots, private-resource lookups and mandatory manual approval. Route tests exercise CRM read/planning rounds without live writes.
- `node --env-file=.env.local --experimental-strip-types scripts/verify-agent-crm-tools.ts` evaluates the configured model on synthetic requests for follow-ups, product edits, catalogs, orders, invoice lifecycle/payments, flow changes, messaging, preferences and record lookup. It never reads actual CRM records, stores proposals or executes actions.
- Run `tests/agent-actions-database.sql` in a transaction to check actual claim semantics and database privileges. It rolls back its test data.
- `node --env-file=.env.local --experimental-strip-types scripts/verify-agent-provider.ts` checks model output using synthetic company/product/payment data, dictated shipping and discounts, details-only invoice corrections and draft flow creation. It never saves invoices or flows or sends email.
- `node --env-file=.env.local --experimental-strip-types scripts/verify-agent-page-context.ts` checks a draft reply to an unmatched selected email, an open Messenger draft and an existing-flow edit preserving unsaved changes, using synthetic data only. It requires working provider credentials and never reads CRM records or executes actions.
- `node --env-file=.env.local --experimental-strip-types scripts/verify-agent-email-profile.ts` checks real provider behavior for email lookup without an open conversation, a misspelled address request, latest-address corrections and missing shipping details using synthetic messages only.
- `node --env-file=.env.local --experimental-strip-types scripts/verify-customer-research.ts` checks live Google Search and website grounding using public Prusa company information. It reports source labels and safe error categories without printing credentials or CRM data.
- Authenticated browser verification requires signing in to the local CRM. Live email delivery requires an explicit recipient and send request.
