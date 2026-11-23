# Plans and AI credits

Prices apply per paid seat per month. Capacity and AI credits are pooled within
one workspace. All plans include existing CRM features, subject to existing role
permissions and these quotas. There are no automatic renewals or top-ups.

| Per-seat allowance | Starter | Pro | Business |
| --- | ---: | ---: | ---: |
| USD reference price | $19 | $39 | $79 |
| Alipay CNY checkout | 楼139 | 楼279 | 楼559 |
| AI credits / subscription month | 2,000 | 5,000 | 12,000 |
| Customer companies | 1,000 | 10,000 | 50,000 |
| Products (parent SKU records) | 500 | 5,000 | 25,000 |
| Connected mailboxes (including paused) | 1 | 3 | 5 |
| Saved workflows (including drafts) | 3 | 20 | 100 |
| New workflow runs / calendar month | 1,000 | 10,000 | 50,000 |
| Document-library storage | 1 GB | 5 GB | 20 GB |

Seats are purchased up front, from 1 to 100. All members, including the owner,
count toward seat capacity. Renewals preserve the current plan and seat count;
changes are accepted after expiry. Reducing capacity never deletes existing
records. It prevents additional allocation above the new quota. Existing daily
email sending and provider limits still apply separately.

The current payment integration is Alipay in CNY. USD prices are reference
prices; there is no USD card checkout. Merchant payment activation is still
required if Alipay payments are disabled in the environment.

## Credit accounting

One credit is 1,000 USD micro-units of conservatively priced provider usage
($0.001). Fractional credits are retained to three decimal places; a model call
is not rounded up to one whole credit. Credits are not tokens or message counts.
Published model rates, context tiers, reserved output and search fees determine
the reservation. This is a normalized usage charge, not an exact provider invoice
reconciliation: input cache discounts are not assumed and uncertain billed
requests retain their reservation.

An AI call reserves its maximum estimated cost before contacting the provider.
Atomic grant allocations share a workspace lock. Confirmed usage settles once,
releasing unused credit. Repeating settlement with a different amount fails.
Interrupted requests retain their reservation, and settlement outages never
trigger a second paid provider call. Existing workspace and member safety caps
remain additional restrictions for workspaces that use legacy spending controls;
raising them cannot mint commercial credits. In plan-credit-only mode, the credit
wallet is the sole spending allowance and those legacy caps do not apply.

Included credits expire at the end of each paid subscription month. Paying a
renewal early does not grant the next month's credits early. The next grant is
created lazily when that period becomes active; no billing cron is required.
All AI features, including background tagging and workflow AI, use the existing
budgeted provider boundary.

Credit pack: 3,000 credits for 楼69 (USD reference $10), valid for one year.
Only an active workspace's owner can purchase it. Credits with the earliest
expiry are consumed first. A refund revokes the corresponding grant without
rewriting its usage history. A top-up neither adds seats nor extends CRM access.
When credit is insufficient, new AI calls stop; ordinary CRM continues while
the workspace subscription is active.

Pre-existing beta workspaces keep their CRM access and receive 10,000 shared
credits per China calendar month, rather than a per-tester allowance. Existing
administrative spending limits still apply. Legacy Starter 楼99/1 seat and Team
楼299/5 seats retain their renewal prices and use a 2,000-credit allowance per
included seat. Historical AI spending is not retroactively debited from the new
wallet. Requests already reserved before migration settle without double debit.

## Enforcement and review

`crm_billing` holds the private catalog, grants, allocations and durable monthly
workflow counters. Browser roles have no grants. Public RPCs are restricted to
trusted server roles, and tenant-table access retains RLS. Narrow private
capabilities use explicit workspace predicates. Record triggers enforce quotas
for manual entry, imports and AI tools. Storage enforcement counts actual
`workspace-documents` objects, including trash and unregistered uploads; email
attachments and other storage buckets are not part of this document allowance.

Administrators can review plan allowances, credit balances and workspace usage
at `/settings/credits`. Owners can buy packs there. Internal request logs and
model/provider details are excluded from the customer-facing billing view.
Optional spending controls for workspaces that use them remain at `/settings/ai`.
Plan changes and renewals are at `/subscribe`.
Other members can view the shared credit balance without access to the billing
ledger or checkout controls. The overview uses a summary-only database response;
it does not query or return internal AI request history. Active team membership
is counted separately from subscription seats. Refresh is user initiated, with
loading and retry states rather than background polling.
The sidebar's AI usage shortcut opens a compact balance popover. Its member-safe
`/api/ai/credits` endpoint derives the actor and workspace from the signed-in
session and returns only credit totals and account availability. It reads on
open or manual refresh, aborts when closed and does not poll while idle.

Complimentary subscriptions are private, server-managed grants rather than paid
orders. They apply the selected plan's per-seat capacity and monthly credits,
renew on the China calendar month, and block subscription checkout. Existing
beta credit usage is preserved when its allowance is upgraded. Only the original internal Filazoo workspace
has been granted six complimentary Business seats; other workspaces retain
their existing terms. This does not waive hosting or AI provider bills.

Filazoo uses plan-credit-only AI billing: 72,000 shared monthly Business credits,
without the previous $30 cap, daily division or member spending overrides.
The settings editor shows plan credits instead of legacy dollar controls, and
stale editors cannot reintroduce the old caps. Existing usage and reservations
are preserved. Credits are still reserved atomically before every paid call.

Migration: `supabase/migrations/20261123032555_commercial_credits_and_plan_limits.sql`.
It preserves existing access, contracts, pending legacy orders and reservations.
Deploy the application and migration together: stage a production build, verify
the SQL in a transaction ending in rollback, apply the migration, smoke test,
then promote the tested deployment. Rolling back the application is supported;
do not drop the ledger or discard paid allocations during rollback.

Database regression coverage: `tests/commercial-credits-database.sql`. Run after
the migration in a transaction ending in rollback. Fixtures exercise payment
replay/tampering, credit allocation and settlement, renewals, top-ups, refunds,
expiry, role isolation, quotas, storage, legacy renewal and beta grants without
making real provider calls or payments.


Follow-up integrity migration: supabase/migrations/20261123033212_seal_legacy_billing_and_private_ledger_policies.sql. It seals retired checkout prices and documents private ledger RLS policies.

Usage counter migration: `supabase/migrations/20261123033838_count_uncapped_workflow_usage.sql`.
It records beta and legacy workflow starts as well as capped usage, without
reducing durable counts when old run history has been removed.

Billing summary migration: `supabase/migrations/20261123060512_customer_billing_summary.sql`.
The administrator and workspace checks remain in the RPC. Summary privacy,
active member count and non-admin isolation are covered by the rolled-back
`tests/credit-only-ai-usage-database.sql` fixture. The page calculates fractional
usage from ledger totals, handles exhausted balances and warns at capacity.
Checkout is shown only to owners when payments and the subscription are active.
