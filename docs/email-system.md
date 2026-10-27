# CRM email receiving and replies

## Company Email tab

Company profiles include an Email tab (`/companies/[id]?tab=email`) using the existing mailbox reader and reply composer. It starts in All mail so incoming messages and saved sent replies appear together. Messages match the company's primary and additional saved contact email addresses exactly, ignoring case and surrounding whitespace; company names and shared domains never expand the match. Companies without an email address show guidance to add one.

The initial server response and `/api/email/inbox?companyId=...` refresh responses both filter messages to those contacts. The client also filters snapshots before updating the list. The company view has two columns: a conversation list with search, All/Unread filters, refresh and New email; and a reader with the same reply composer as the main mailbox. The composer opens expanded for company conversations, with AI writing enabled, AI reply, suggestions, attachments, catalogs, permitted invoice tools, emoji and calculator. AI draft previews and generation use the existing shared implementation. Narrow screens show the list or reader with a Conversations back button. Mailbox folders, bulk controls, automation, repeated account details, stars and category/source filters are omitted. Translation is optional and starts off. New conversations offer only the company's saved contact addresses. The tab uses the viewer's existing authorized mailbox and saved-history limits; it does not import a separate company mailbox or send messages automatically.

## Mailbox structure review — October 22, 2026

The supplied OKKI reference has three states: a full-width mailbox overview; a selected message with a compact list, reader, and contact context; and an expanded inline reply. Persistent folder navigation, small date-grouped rows, unread emphasis, message actions, and independent scrolling make those states usable together.

The previous CRM opened the first conversation automatically, used large message cards and chat bubbles, hid folders and contact details below the widest breakpoint, duplicated Compose, and left the complete reply toolset permanently open. A second CRM navigation sidebar further reduced the reading area.

The email workspace now follows that structure:

- The initial view is a dense, date-grouped list with sender/address, subject, preview, time, unread state, reply/attachment indicators, stars, and selection. Opening a row switches to a compact list and document-style reader; Mailbox returns to the overview.
- Email is a standalone main navigation item, separate from Outreach, on desktop and mobile. It opens the mailbox directly without a secondary CRM submenu. Mail folders remain visible on desktop, with a folder selector on smaller screens.
- Inbox, Needs follow-up, Unread, All mail, Drafts, Scheduled, Sent, Starred, Archive, and Trash use existing message data and saved state. Needs follow-up uses the saved category. Sent uses outbound direction. Counts represent conversations in the loaded CRM snapshot, not provider-wide mailbox totals.
- Search, source/category filters, 30-conversation pagination, previous/next conversation navigation, and select-page controls work together. Bulk read/unread, archive/restore, and trash actions use `/api/email/state`; failed updates are reported without claiming success.
- Contact and follow-up details can be opened at every screen size. They appear alongside the reader on wide desktops and as an overlay on smaller screens. Quick reply expands on demand; collapsing it retains its content. Translation is available in the reader toolbar.

Provider spam/custom folders are not implemented: the persisted folder model currently supports Inbox, Archive, and Trash, independently of IMAP provider folders. Drafts and Scheduled show existing CRM records; the new-message composer does not yet save resumable drafts or schedule sends. AI guidance in the contact panel is general guidance, not a generated spam or buying-intent classification. These require separate backend work and should not be represented by cosmetic controls.

Verification used the authenticated local mailbox: saved inbox rendering, on-demand original HTML body loading, persisted read state, translation, reply expand/collapse, search, pagination, and bulk selection controls. Layout checks at 390 px and 1280 px found no document-level horizontal overflow; the normal wide desktop showed the list, reader, and contact panel together. No customer email was sent and bulk mutations were not exercised on customer messages. TypeScript, lint, tests, and production build are also checked before delivery.

The mailbox inbox used to download and parse 500 complete MIME messages on every 30-second refresh (1,000 for history). Attachments and provider login delays blocked every other message. It also silently excluded unknown senders. Saved CRM replies omitted RFC identifiers, so duplicate copies could appear as separate conversations. The reply composer selected the latest item's contact instead of the latest inbound message's Reply-To.

## Current flow

1. `/emails` and `/api/email/inbox` return saved messages immediately. The inbox route schedules provider refresh with Next.js `after`; the browser checks the saved result every 10 seconds while visible, and on focus.
2. The shared database lease permits one inbox sync per mailbox across server instances. `mailbox_sync_state` records UIDVALIDITY, the last acknowledged UID, errors, and up to 1,000 recent headers. A failed sync preserves the previous snapshot and cursor.
3. New mail sync imports at most 10 headers per batch, oldest first after the checkpoint. Initial sync takes the latest 10. Import history adds up to 25 older headers per click without rewinding the new-mail checkpoint. A UIDVALIDITY change discards the old epoch's header cache.
4. Opening a message calls `/api/email/message`. Only that message's plain-text and HTML MIME parts are downloaded, decoded with MailParser, and saved in `mailbox_message_content`. Older messages in a conversation have a Load message control. Attachments download separately through an authenticated route; inline image CIDs resolve through the same route.
5. Warm servers reuse authenticated IMAP sessions and serialize operations per session. IDLE mail/expunge notifications invalidate the checkpoint; unchanged checks can reuse it for up to 30 seconds. A periodic UID query still reconciles the provider. Connections expire after two idle minutes. Database snapshots remain authoritative across cold starts.
6. The existing minute cron also refreshes active mailbox caches when no live automation exists. Automation retrieves content only for new matching CRM replies; it does not store an empty header-only body.

## Conversation and sending rules

- Threading follows Message-ID, In-Reply-To, References, and saved CRM keys, including incomplete immediate-parent chains. Identical subjects alone do not combine inbound conversations. The restricted legacy outbound `Re:` fallback remains for older sent records.
- IMAP and CRM copies of the same received Message-ID are deduplicated. Saved CRM replies retain their message and thread identifiers.
- Reply uses the latest inbound Reply-To, or its From address. Sent-only conversations continue to the sent recipient. The composer displays the actual destination and keeps new-email composition separate.
- Reply headers retain original message-ID casing. Normal new messages have no reply headers. Plain text is not passed as HTML; explicitly supplied HTML remains a separate MIME alternative. SMTP connections have bounded timeouts and close after sending.
- Recognized quoted history is collapsed in the reader, with the original complete message available to expand.

Both cache tables have RLS enabled and deny direct anon/authenticated access. Server routes resolve the viewer's authorized effective mailbox and check its opaque mailbox key before serving content or attachments. Credentials are never stored in the cache or printed by the verification script.

## Verification and limits

AI reply is separate from AI writing. AI writing rewrites the manager's input in English, including the greeting, sign-off, and BD Sales Manager title, regardless of the CRM interface language or whether the input is Chinese, English, or mixed. Proper names and product identifiers are preserved. AI reply calls `/api/email/reply` to draft a response from the last eight original messages and the customer company profile, without requiring typed input. Header-only messages are loaded before generation. The existing Gemini provider and regional AI Gateway fallback must be configured and funded.

Catalog requests prepare a PDF using the latest saved company catalog selection, or the complete available product catalog. Explicit order requests return exact product/variant selections and quantities. The client then loads current billing context and prices through the existing invoice APIs, applies quantity tiers, validates MOQ and currency, saves a draft invoice, and downloads its draft PDF. Only roles already allowed to create invoices can perform this step. Unknown products, ambiguous variants, missing prices and mixed currencies require review. Shipping and tax amounts are not inferred.

The reply is installed only after all requested PDFs are ready. Users review the message and attachments and click Send email themselves. Generation never issues an invoice or sends an email. PDF retries reuse the saved draft for the same source customer message, and switching conversations prevents subsequent invoice writes and stale composer updates. The draft invoice review link opens the existing invoice editor.

Run `npm test`, `npm run lint`, and `npm run build`. Receive-only checks:

```powershell
node --env-file=.env.local --experimental-strip-types scripts/check-flow-mailbox.ts
node --env-file=.env.local --experimental-strip-types scripts/verify-email-sync.ts --workspace --content
```

On October 22, 2026, both default mailboxes passed SMTP/IMAP authentication. Workspace verification received two new messages; the header sync took 13.9 seconds including a cold login, an immediate unchanged check took under 1 ms, and saved reload took 0.75 seconds. An uncached message body loaded in 5.3 seconds and its cached copy in 1.1 seconds. These are local measurements, not delivery-time guarantees. Gmail was substantially slower from this environment: one initial import took 96 seconds and a warm provider query took 26 seconds before IDLE checkpoint reuse was added. Background refresh keeps those waits out of the page response.

The inbox cache intentionally shows at most 1,000 recent mailbox messages; it is not a complete mailbox archive. Attachments are downloaded only on demand and capped at 25 MB per MIME part. Full external delivery and provider spam placement were not tested by sending customer email: MIME sending checks use Nodemailer's local stream transport.

The database migration is `supabase/migrations/20261022055049_mailbox_incremental_sync.sql`; equivalent table definitions are in `supabase/schema.sql`. Application changes require deployment to affect the hosted CRM.

## BD manager email visibility

The email page and inbox API restrict BD managers to saved contact addresses on companies currently assigned to them through `pipeline.owner_id`. This includes automatic and manual assignments and every contact on each company. Other managers' customers, unassigned customers, and unknown senders are excluded from every inbox folder and the automation queue count. Matching uses exact email addresses, never company names or domains. Message bodies and attachment downloads enforce the same ownership check. Assignment lookup errors deny access; they do not fall back to the shared inbox. Admin, operator, and viewer access is unchanged.

## Sources

- [RFC 5322, sections 3.6.2 and 3.6.4](https://www.rfc-editor.org/rfc/rfc5322.html): Reply-To and conversation headers.
- [node-imap API](https://github.com/mscdex/node-imap): UID ranges, UIDVALIDITY, MIME structure, body-part fetching, and IDLE events.
- [Nodemailer message configuration](https://nodemailer.com/message): plain text, HTML, reply headers, and attachments.
- [MailParser](https://nodemailer.com/extras/mailparser): MIME decoding and parsed message identifiers.
- Next.js 16.4 bundled guides in `node_modules/next/dist/docs/`: route handlers, `after`, and `maxDuration`.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): cache access boundaries.
