# FILAZOO CRM agent

The CRM owns the agent's business knowledge, available actions, permissions and execution. A model interprets the request and calls those tools. Switching a qualified model does not require fine-tuning or rebuilding the agent.

In this CRM, **catalog is the previous name for quotation**. Both refer to Company Quotations. An invoice is a separate payment document. A quotation can start as a product selection, become a priced offer, record customer acceptance and create a draft order. It never silently becomes an invoice.

## What the agent can do

The versioned registry currently exposes 58 typed actions across customers, quotations, invoices, orders, products, email, tasks, workflows and settings. These include partial customer edits, private product prices, saved audience segments, quotation revisions/status, invoices/payment actions, order creation, email drafts and explicitly requested sending, conversation auto replies, follow-ups, prepared task actions, shipment updates, signature editing and administrator AI settings.

The complete feature inventory is [agent-capability-audit.json](./agent-capability-audit.json): server-action and mutating API exports classified as direct, guided, read helpers or internal infrastructure. The generated inventory contains the current counts as account and workspace features evolve. Multiple UI surfaces can share one agent tool, and one UI surface can expose several tools. Guided features remain UI handoffs, not completed agent actions. File uploads, passwords/OAuth/connection credentials, account/workspace ownership flows and specialized workflow test/composition controls use their existing forms.

Existing saved quotations can be attached by their real quotation ID. The server checks ownership and an approved fingerprint again when opening a draft or sending it. It renders the saved priced document or saved product selection, preserving agreed amounts instead of substituting today's whole product list.

Contract `2026-11-05.2` changes the default quotation scope: read the customer's actual email and include only requested products. An all-product selection requires an explicit user instruction. The server independently grounds new quotation selections and new quotation attachments, so changing models cannot restore the old blanket-catalogue default. It prefers exact saved product names/SKUs and unambiguous base materials, excludes unrelated specialty grades, and asks about missing or ambiguous names. Quoted old email text and outdated subjects cannot add products to a newer request. An explicitly selected existing quotation keeps its own saved content.

History/session recovery also returns JSON 503 on temporary workspace-verification failures, retries read-only session RPCs once, and gives the sidebar a retry control that preserves typed messages. Mutations and sends are never automatically replayed. An authenticated viewer's workspace is bound to that request so each data client does not repeat the same session lookup. Role checks and workspace isolation remain mandatory at request and action boundaries.

## Execution

The existing application already uses Next.js route handlers and CRM services. Vercel AI SDK 7's `ToolLoopAgent` now runs native tools for Gateway Agent requests. The Responses-compatible Gateway transport supports the selected Google and Anthropic models. Keeping the existing server services avoids introducing another durable-agent framework or duplicating the CRM.

1. Authenticate and load the authoritative saved conversation, selected record, accessible customer history and workspace policy.
2. Expose the relevant tool domains. The model can discover other domains and perform bounded, permission-scoped reads.
3. Validate tool arguments with the same Zod schemas used by the executable action layer. Portable JSON Schema presentation handles provider differences, such as empty-string enums; it never relaxes server validation.
4. Apply deterministic document-intent checks. Invoice/quotation substitution is rejected. A quotation email draft uses the existing attachment service rather than an unrelated document action.
5. Stage proposals in memory. The model loop performs no business mutations. Failed or mixed read/action batches are discarded.
6. Existing preparation, review, stored action claims, stale-record fingerprints and business services validate and execute the actions. Mandatory financial/destructive/admin reviews remain in force. A completion claim requires a saved execution result.

Local function schemas and arguments count as input/output tokens. Application usage limits and Gateway budget reservations have been removed. Each model step has bounded output, no hidden SDK retries, no provider conversation storage and no provider-side computer/code tool. Existing chat history and usage tracking continue to wrap the transport.

## Changing models or adding features

Gateway credentials are resolved inside each request by `lib/ai/provider-credentials.ts`. An explicit `AI_GATEWAY_API_KEY` takes precedence; otherwise the official `@vercel/oidc` helper reads Vercel's trusted runtime request context, with `VERCEL_OIDC_TOKEN` supporting local development and standalone workers. Enable OIDC in the linked Vercel project. Production does not require copying a local expiring token into environment settings. Agent, chat, email, research, workflows, tagging and inbox availability use the same resolver. Credentials are never cached across requests. Existing provider selection remains compatible with the legacy budget flag, which no longer enables allowance checks.

Model selection remains in `lib/ai/model-routing.ts` and environment settings. New model IDs must also have current pricing and reservation-policy support. Run the same synthetic qualification suite before enabling a new model. This is regression testing, not model training; arbitrary models are not assumed to have reliable tool support.

For a new CRM feature, add its typed action schema, business-service adapter, policy classification, label and domain description. The registry generates the model-facing contract from those executable schemas. Add relevant tests and update `scripts/audit-agent-capabilities.ts`, then regenerate the audit. The coverage test fails when a new server-action/API export has no inventory entry. Each guided feature must say where to continue and must not claim execution.

`AI_AGENT_RUNTIME=sdk` is the default for Gateway Agent requests. `legacy` is an explicit rollback to the previous text-command loop; direct Gemini compatibility still uses that older path. Normal Chat remains read-only. No production deployment is implied by this code change.

## Verification

Production authentication was repaired and released on 2026-11-05. The isolated release passed 1,249 tests, TypeScript, lint and Vercel's production build. The custom domain was verified against the new deployment, and a signed-in live Agent request completed in 5.4 seconds. See [production-ai-auth-20261105.json](./audit-evidence/production-ai-auth-20261105.json).

`tests/native-agent.test.ts` checks the actual SDK loop, native transport, permission denial, clarification, failed-batch isolation, document aliases and budgeted function tools. Existing agent preparation/execution tests cover the shared services. `tests/agent-capability-audit.test.ts` checks inventory drift.

The initial SDK rebuild passed 1,213 tests, lint, TypeScript and an isolated production build under `tmp/agent-next`. Follow-up contract `2026-11-05.2` passed 1,247 tests, lint and TypeScript, including customer-specific quotation selection and history recovery. Saved history loading and a quotation review card were observed in the running local CRM. Verification did not automatically approve a proposal or send customer messages. The earlier full-product draft remains its original saved document; corrected customer-specific selections require a new quotation proposal.

`scripts/verify-native-agent-models.ts --live` uses synthetic customer/product data and a maximum $0.10 outstanding-cost allowance. The latest evidence is [native-agent-models-20261105.json](./audit-evidence/native-agent-models-20261105.json): all 8 cases passed across Claude Haiku 5.5 and Gemini 3.5 Flash Lite, with approximately $0.0214 in measured token cost. It never reads real CRM customer data, stores actions or sends messages. This qualifies these scenarios, not every possible customer request.
