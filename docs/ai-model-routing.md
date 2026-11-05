# Task-based models through Vercel AI Gateway

Set server-only `AI_PROVIDER=gateway` after confirming Gateway billing and access.
Vercel deployments use their automatic `VERCEL_OIDC_TOKEN`. Local development
can use an `AI_GATEWAY_API_KEY` in ignored `.env.local`; never put keys in chat,
browser code, or committed files. Existing Gemini credentials remain available
for public Google-grounded research and an explicit provider rollback.

For normal local use, run `npm run crm` and open `http://localhost:3001`.
This rebuilds the optimized app in `.next-crm` using the local environment.
After a successful build, `npm run crm:start` restarts it without rebuilding.
The local build uses two prerender workers so it can run alongside development
without the Windows worker crash observed with eleven workers. A development
server on port 3000 can continue using its separate `.next` output.

The prepaid preference is one $50 top-up, with automatic top-up disabled. The
application does not purchase credits or increase a budget. Exhausted credits
produce an actionable error and do not switch to another paid account. Gateway
credits are shared by the Vercel team. Purchased credits, key quotas, and project
budgets are separate controls; topping up does not reset a key quota.

## Model selection

The 5 November request replaces the earlier nano-only preference. Model selection
is local code, with no separate classifier request. The live catalog and a bounded
synthetic evaluation inform these defaults:

| Work | Gateway model | Reasoning | Input / output USD per million tokens |
| --- | --- | --- | --- |
| Email writing, rewriting, summaries and tagging | `google/gemini-2.5-flash-lite` | none | $0.10 / $0.40 |
| Chat, routine CRM actions, catalogs and image inputs | `anthropic/claude-haiku-5.5` | none | $0.10 / $0.50 |
| Invoice/quotation planning, invoice replies, workflow extraction, protocol repairs | `google/gemini-3.5-flash-lite` | low | $0.30 / $2.50 |
| Public web research | `openai/gpt-4.1-mini` | not applicable | $0.40 / $1.60 plus search |

Prices are base text rates checked on 5 November 2026; cache writes, long-context
tiers, tools and provider routing can change the charge. The allowance reservation
uses current catalog pricing, not this table. Image routing stays on the priced
vision-capable Haiku default so conservative full-context image reservations fit
the existing small daily allowance. Explicit overrides must be in the same tested
model allowlist. Legacy nano-only pins are ignored; a generic email or agent pin
cannot downgrade invoice planning or protocol repair.

All generations use `/v1/responses` with `store:false`, including Google and
Anthropic through Gateway's compatible API. Reasoning controls are model-specific;
the non-reasoning research model receives no reasoning parameter. Existing schemas,
authentication, approvals, execution locks and verified price calculations still
govern every CRM write. Public research uses its dedicated route when budget
enforcement is enabled; direct unmetered Gemini research remains disabled.
Research requests include native search-source metadata. When a provider omits
URL annotations, a Markdown citation is accepted only if its exact public URL
was returned by the search tool. Generated links alone cannot verify a claim.

## Reliability and usage

Generation retries at most once for temporary network failures, attempt timeouts,
and selected HTTP errors. Short `Retry-After` values are honored; long cooldowns,
authentication errors, payment errors, and permission errors are not retried.
Cancellation and request deadlines propagate. Incomplete Responses output is
rejected before it can become an agent proposal. Retries only generate text;
they never rerun a save, send, payment recording, or other CRM mutation.

Chat usage supports both Responses and legacy token counters. To show estimates,
set `AI_CHAT_MODEL_RATES_JSON` to current per-million rates, for example:

```json
{"google/gemini-2.5-flash-lite":{"input":0.1,"output":0.4},"anthropic/claude-haiku-5.5":{"input":0.1,"output":0.5},"google/gemini-3.5-flash-lite":{"input":0.3,"output":2.5},"openai/gpt-4.1-mini":{"input":0.4,"output":1.6}}
```

These are estimates, excluding cache discounts and other provider charges.
Vercel's credit balance and request logs remain the billing source of truth.

Run `node --env-file=.env.local --experimental-strip-types scripts/benchmark-ai-models.ts`
to preview the synthetic comparison; add `--live --selected` to test the selected
routes. This explicitly requested diagnostic uses synthetic records only and a
separate conservative $0.10 maximum quote per invocation, without changing the
production allowance or running any CRM action. It is not a benchmark of the
browser or database. The default comparison includes five candidate models;
expensive cases may be skipped at the cap and are reported as skipped.

The final five-case run passed customer catalog creation, the reported catalog
email follow-up, invoice preparation, invoice protocol recovery and short email
writing. Model response times were about 0.9s for writing, 2.4-2.5s for catalogs,
and 6.0-6.1s for invoice planning/recovery. These are individual observations,
excluding CRM loading, PDF generation and browser time, not latency guarantees.
The initial nano comparison failed both action cases. See
[current evidence](audit-evidence/ai-model-routing-20261105.json) and
[historical evidence](audit-evidence/ai-model-routing-20261104.json).

General catalog requests use saved currency and active products without another
confirmation. A requested catalog email draft uses one `write_email` action with
`attachCatalog:true`, not a redundant catalog-creation step. Subjects are drafted
and saved recipients reused. Invoice-only requests omit email actions. Customer
emails use short paragraphs and omit unrequested headings, plans, commitments and
reconfirmation questions. The answer renderer exposes one text copy, avoiding
duplicate clipboard/accessible text.

Sources: [Vercel model catalog](https://ai-gateway.vercel.sh/v1/models),
[Responses API](https://vercel.com/docs/ai-gateway/sdks-and-apis/responses),
[reasoning controls](https://vercel.com/docs/ai-gateway/models-and-providers/reasoning).

## Workspace allowance

`AI_BUDGET_ENFORCEMENT=true` enables the private Supabase reservation ledger.
Apply `20261104084056_workspace_ai_budget.sql` before enabling it. The server
attributes every generation and background job to its authenticated caller or
automation owner. Unpriced models and direct Gemini calls fail closed.

Apply `20261104093655_workspace_ai_nano_daily_reset.sql` for private daily-reset
audit events, followed by `20261105004226_workspace_ai_task_routing.sql` to allow
the tested task models. Nano remains accepted for rolling restarts and existing
reservations; new routed requests do not select it. A daily reset excludes the member's earlier requests from today's
allowance; original usage records and the monthly billed total remain intact.
New usage counts normally, and the reset expires at China-time midnight.
The daily and monthly allowance amounts remain unchanged. Browser roles cannot
record resets. Authorized resets take the existing budget-policy lock.
`tests/ai-budget-database.sql` verifies model restrictions, reset behavior,
monthly preservation, new usage and privileges in a rolled-back transaction.

The shared calendar-month allowance is $30 in Asia/Shanghai. The daily workspace
allowance is $30 divided by days in that month; each active member gets an equal
share with a minimum of five shares. November therefore allows $0.20 per member
per day; a 31-day month allows $0.193548. Unused daily allowance does not roll over.
The database lock serializes reservations across local CRM and hosted workers.

Before sending, requests reserve a conservative input/output/tool cost from the
current public Gateway catalog. Cached-input discounts are not assumed and cache
write/long-context rates are included. Successful requests settle against reported
tokens. Uncertain failures retain their full reservation; reservations never
automatically expire and release potentially billed spend. Administrators may
reconcile these against provider logs. This allowance is deliberately conservative
and is not an invoice. Historical unpriced Gemini events remain unpriced; known
historical costs and the observed pre-rollout Gateway balance are included.

Requests can be declined before the meter reaches 100% when their maximum cost
exceeds the remaining allowance. Image requests use the full model-context bound
and may exceed this small daily allowance. Web research uses one bounded search
via Gateway; direct unmetered Google research is disabled with enforcement enabled.
The AI usage button shows personal daily and workspace monthly percentages;
running-request reservations are included and the open panel refreshes every 30s.

Vercel's team and local API-key budgets are also $30/month as a backup. Vercel
resets at UTC and is a soft cap for in-flight calls; the application reservations
enforce the China-time calendar independently. Do not run paid verification scripts
without an explicit trusted workspace user and a bounded approved test allowance.
