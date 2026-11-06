# Workspace AI access and behavior

Open **Settings → AI access & behavior** (`/settings/ai`). All active members can inspect the shared policy; only administrators can save it. English and Simplified Chinese are supported.

The page provides a master AI switch, seven feature switches, nine CRM data scopes, twelve action permission categories, a default tone and response detail, and separate business, general, and email writing instructions. Changes use an explicit Save action, pending/error/success feedback, Discard, and review-first defaults. Concurrent edits are rejected rather than silently overwriting another administrator's policy.

Each action category supports **Blocked**, **Require approval**, and **Allow automatic**. Defaults keep the existing feature and data availability and require review for every action. Automatic permission still respects the agent's Ask mode and existing mandatory review rules. User roles, record ownership, mailbox access, invoice validation, catalog validation, and delivery safeguards remain authoritative.

## Enforcement

Application usage limits were removed on November 5, 2026. Settings no longer shows workspace budgets, daily caps, automatic shares or per-member spending controls. Chat no longer shows allowance meters. Provider requests bypass the old reservation ledger even if `AI_BUDGET_ENFORCEMENT=true` remains in an existing environment. Historical usage and budget data remain stored. The workspace AI master switch, feature switches, data scopes and action permissions still apply.

History startup restores the latest conversation and messages in one HTTP request. List checks reuse mailbox snapshots only within the current authenticated request and omit full customer activity and email body loading. Client reads have a 15-second operation deadline, and the assistant code warms after the page settles. Deletion checks ownership under a database row lock, protects requests less than five minutes old, cancels pending proposals, cascades transcript removal, and preserves usage and completed audit actions.

The November 5 update passed 1,256 automated tests, lint, production build, bundle budgets, and rollback-only database tests for both the new controls and the existing history/budget contracts. Local browser verification reached the workspace chooser because the signed-in local account has no workspace membership; the new admin form was not verified in an authenticated browser session. Its access was left unchanged.

- Chat, customer chat, research, image input, email rewrites, summaries, translations, and reply planning check the saved policy before contacting a provider.
- Agent context loaders omit disabled CRM sources. Tool lookups independently check their required scopes. Customer profiles omit commerce fields when billing access is disabled.
- Agent action preparation classifies every supported operation. Unclassified operations are blocked. Combined invoice/email/catalog actions require all relevant permissions. Activating or editing a potentially live flow also requires sending permission.
- Execution checks the latest saved policy again. Previously prepared automatic proposals cannot bypass a new review requirement. Export and draft retrieval also recheck permissions.
- Background AI flow replies, conversation auto-replies, and AI task preparation check their feature, data, and action permissions. Background work requiring approval pauses instead of sending. Conversation auto-reply enablement and shipping approval also validate the policy. Email workers recheck immediately before delivery; automatic invoice creation/issuance checks the relevant financial permissions.
- Template-only email flows remain governed by their existing controls; this policy governs AI work.

With any CRM data scope disabled, new model requests exclude page snapshots, unsaved flow edits, previous chat turns, saved summaries, and previous execution results. This prevents old context from reintroducing revoked data. Such requests use the latest explicit user message and newly permitted records, without continuing persistent server chat memory. Customer chat conservatively omits mixed activity history whenever access is restricted. User-typed/pasted text can still be transmitted. Existing stored chats are not deleted and sent messages are not recalled.

The scopes control CRM sources, rather than attempting to redact every mention of a topic inside an otherwise allowed source. For example, an allowed email may contain customer-supplied product or payment information. A task requiring several sources needs all of those scopes enabled.

## Persistence and rollout

`workspace_ai_settings` is a server-only singleton with validated JSON, a revision, and last-editor/time metadata. RLS is enabled and `anon`/`authenticated` have no table access. The authenticated server action checks the current administrator role before using the service-role client. Reads have no process cache so background workers see revocations. An unavailable or malformed policy fails closed.

Migration: `supabase/migrations/20261031031803_workspace_ai_settings.sql`. It was applied to the connected CRM Supabase project. Apply the migration before deploying this code to other environments; otherwise AI requests intentionally fail until permissions can be verified. Provider credentials/model IDs remain in existing server configuration.

## Verification

Tests cover schema validation, administrator-only writes, all tool classifications, combined permissions, flow activation, denied requests before provider/history access, omission of restricted context, pending automatic proposals after policy changes, stale concurrent writes, and database failures. Existing provider and workflow fixtures explicitly opt into automatic permissions to preserve their individual feature scenarios.

Live browser verification confirmed rendering, accessible switch names, save feedback, and persistence across reload. The writing tone was temporarily changed and restored; no customer messages were sent. Database checks confirmed RLS and denied anonymous/member access. The security advisor's no-policy informational notice is expected for this intentionally server-only table.
