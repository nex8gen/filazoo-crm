# CRM email receiving and replies

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

Run `npm test`, `npm run lint`, and `npm run build`. Receive-only checks:

```powershell
node --env-file=.env.local --experimental-strip-types scripts/check-flow-mailbox.ts
node --env-file=.env.local --experimental-strip-types scripts/verify-email-sync.ts --workspace --content
```

On October 22, 2026, both default mailboxes passed SMTP/IMAP authentication. Workspace verification received two new messages; the header sync took 13.9 seconds including a cold login, an immediate unchanged check took under 1 ms, and saved reload took 0.75 seconds. An uncached message body loaded in 5.3 seconds and its cached copy in 1.1 seconds. These are local measurements, not delivery-time guarantees. Gmail was substantially slower from this environment: one initial import took 96 seconds and a warm provider query took 26 seconds before IDLE checkpoint reuse was added. Background refresh keeps those waits out of the page response.

The inbox cache intentionally shows at most 1,000 recent mailbox messages; it is not a complete mailbox archive. Attachments are downloaded only on demand and capped at 25 MB per MIME part. Full external delivery and provider spam placement were not tested by sending customer email: MIME sending checks use Nodemailer's local stream transport.

The database migration is `supabase/migrations/20261022055049_mailbox_incremental_sync.sql`; equivalent table definitions are in `supabase/schema.sql`. Application changes require deployment to affect the hosted CRM.

## Sources

- [RFC 5322, sections 3.6.2 and 3.6.4](https://www.rfc-editor.org/rfc/rfc5322.html): Reply-To and conversation headers.
- [node-imap API](https://github.com/mscdex/node-imap): UID ranges, UIDVALIDITY, MIME structure, body-part fetching, and IDLE events.
- [Nodemailer message configuration](https://nodemailer.com/message): plain text, HTML, reply headers, and attachments.
- [MailParser](https://nodemailer.com/extras/mailparser): MIME decoding and parsed message identifiers.
- Next.js 16.4 bundled guides in `node_modules/next/dist/docs/`: route handlers, `after`, and `maxDuration`.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): cache access boundaries.
