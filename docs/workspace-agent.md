# Workspace chat and agent

Chat is read-only. The assistant route discards action output in chat mode and never creates proposals for it.

Agent mode reads the selected company or invoice, billing defaults, current product variants and quantity prices, saved bank accounts, and its previous action results. It supports creating companies, creating draft invoices, updating catalog-based draft invoices, and emailing saved invoices with the actual PDF attached. A create/update request can include an email as a second step. It never issues invoices or records payments automatically. Custom-price and purchase-order invoices remain editable through the invoice editor.

The model chooses record IDs and quantities. The server constructs invoice documents using saved billing details, catalog prices and bank snapshots. Missing prices, ambiguous variants, currency conflicts, and quantities below the catalog minimum require clarification. Updating a catalog line preserves its saved tax rate.

## Approval

The agent starts with **Ask for approval**. Each proposal shows the company, products, quantities, unit prices, total, bank details and email text. The user can approve or decline it. **Auto-approve** executes proposals from new requests sequentially; changing the selector never executes older proposals. Auto approval includes sending an explicitly requested email.

Approval settings live in a small pill at the bottom left of the message composer. Clicking it opens an upward popover with the two approval choices; choosing one closes the popover. While an agent task runs, a collapsible status panel above the composer shows its current operation, target, source page and module icons. Execution stages come from the saved action's progress: checking invoice details, saving a draft, preparing its PDF and sending the email. The authenticated progress endpoint returns only the current user's action status and progress. Planning labels describe request preparation and do not claim an action has already run.

Proposals are stored in `workspace_agent_actions`, owned by the current user and valid for 30 minutes. Execution reloads the stored action, checks membership and approval, and atomically claims a pending proposal. Repeated execution returns the saved result; failed or interrupted actions are never automatically retried. Browser roles cannot write this table directly. Apply `20261026062821_workspace_agent_actions.sql` when setting up another database.

Email uses the user's effective SMTP mailbox and the existing email send/storage workflow. A saved invoice is checkpointed before rendering or sending. If sending fails, the result retains the invoice link. Check Invoices and Sent before requesting another send after an uncertain result.

## Models and configuration

Chat and agent use the existing Gemini connection and model by default. Agent capability comes from its authenticated actions and approval controls. Independent `GEMINI_AGENT_MODEL` / `GEMINI_CHAT_MODEL` overrides are optional; blank values retain the existing email model configuration. The corresponding Gateway overrides are optional too.

The current provider flow tries Gemini and can fall back to Gateway for unsupported locations. Gateway is not required when Gemini works on the published app. The optional Gateway connection needs valid authentication and enabled billing. Local Vercel tokens expire; refresh with `vercel env pull` into an ignored temporary file and preserve local overrides when updating `.env.local`. Do not commit tokens or provider keys. Restart the development server after changing environment settings if Next.js does not reload them.

## Verification

- `npm test` includes invoice construction, read-only chat enforcement, manual/auto approval, ownership, expiry, declines, concurrent execution and partial failures.
- Run `tests/agent-actions-database.sql` in a transaction to check actual claim semantics and database privileges. It rolls back its test data.
- `node --env-file=.env.local --experimental-strip-types scripts/verify-agent-provider.ts` checks model output using synthetic company/product/bank data. It never saves invoices or sends email.
- Authenticated browser verification requires signing in to the local CRM. Live email delivery requires an explicit recipient and send request.
