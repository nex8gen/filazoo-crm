# Plans and AI credits

Catalog v6 uses fixed workspace packages. Included users count the owner.
There is no seat selector or separate subscription charge for an included teammate.
Credits and capacity are shared package totals and are never multiplied by users.
All plans include CRM tools subject to existing role permissions.

| Workspace package | Starter | Pro | Business |
| --- | ---: | ---: | ---: |
| Included users | 1 | 2 | 5 |
| USD monthly reference | $19 | $59 | $129 |
| USD annual reference, paid upfront | $180 | $588 | $1,308 |
| Alipay CNY monthly checkout | CNY 139 | CNY 429 | CNY 929 |
| Alipay CNY annual checkout | CNY 1,308 | CNY 4,308 | CNY 9,348 |
| Shared AI credits / subscription month | 2,000 | 6,000 | 15,000 |
| Customer companies | 1,000 | 5,000 | 20,000 |
| Products | 100 | 500 | 2,000 |
| Connected mailboxes | 1 | 3 | 5 |
| Saved workflows | 5 | 15 | 50 |
| Customer workflow emails / calendar month | 1,000 | 5,000 | 20,000 |
| Document-library storage | 1 GB | 5 GB | 20 GB |

CNY amounts are fixed regional checkout prices, not a live FX conversion.
Annual USD monthly equivalents are $15, $49 and $109. Annual CNY monthly
equivalents are CNY 109, CNY 359 and CNY 779. Annual access lasts twelve
months; its credit grants unlock monthly and expire monthly.

The server derives the included user count from the package. The database rejects
arbitrary quantities, forged prices, underpayments and teams larger than capacity.
The owner and every workspace membership (all roles, including retained inactive
memberships) consume an included user place. Unexpired, unaccepted, unrevoked
invitations reserve places too. Starter therefore cannot invite a second user;
Pro allows one teammate and Business four, when the owner is the only member.
Invitation creation/resend, direct membership writes, acceptance and new-package
checkout share the workspace quota lock. Resending is transactional: failure
keeps the original link valid. Acceptance exchanges the reservation for membership
without double counting; expired/revoked links release capacity. Expired plans
cannot create invitations or accept outstanding ones. The team page shows member,
pending and included counts, and fails closed if capacity cannot be read.
Records are never deleted by a downgrade. Renewals preserve the active package and extend
access after the current paid period. Package changes are allowed after expiry.

`tests/team-plan-limits-database.sql` exercises the actual 1/2/5-user boundaries,
all-role Starter rejection, pending reservations, resends, expiry, removal, bulk
writes and administrator/workspace isolation. `tests/package-resource-boundaries-database.sql`
checks current package entitlements, AI credit rejection, product/mailbox/workflow
caps on all tiers, the Starter company cap, and each storage boundary. Always
run these synthetic database fixtures inside a transaction and roll it back;
they send no email and upload no physical files.

Existing v1–v4 orders keep their quoted price, seats, resource and credit rules.
Active v2/v3/v4 subscriptions renew through a separate server-validated renewal
form with their existing plan, quantity and billing period. Complimentary grants
retain their original capacity and credits, including Filazoo's six Business
users and 72,000 shared monthly credits.

Workflow starts are no longer capped or advertised as a package allowance.
Existing v1–v4 and complimentary subscriptions have no new package email cap;
provider/daily sending restrictions still apply. Historical run counters remain
for audit and are never relabeled as emails. New v6 packages reserve one email
slot immediately before a live customer SMTP submission; accepted sends settle
it once. AI replies count, while drafts, dry runs, test deliveries, internal
alerts and manual inbox messages do not. Definitive failures release the slot;
uncertain submissions retain it for review and cannot automatically resend.
Capacity is pooled by workspace, resets at China-time calendar-month boundaries,
and follows the month in which submission capacity was reserved. Deleting run
history cannot erase usage. At the limit, customer-email actions wait for the
next reset; non-email workflow actions are not charged as email sends.

## Package strategy review — 28 November 2026

The selected limits are a product strategy decision for small B2B sales teams,
not copied competitor quotas or a proven optimum. Keep existing CNY prices,
included users and AI credit budgets, while offering usable catalogs and clear
automation capacity at each growth stage. Starter targets a solo seller with a
focused catalog, Pro a small sales team, and Business a team with multiple
product lines. The 100 / 500 / 2,000 product allowances count saved product
records; they are not a new variant/SKU pricing scheme. Company records remain
separate from contacts, email messages, notes and tasks.

Current official comparisons:

- [Bigin pricing](https://www.bigin.com/pricing.html): Express is $9/user/month
  monthly or $7 annually, with 50,000 **combined** records and 30 automations.
  Its record pool includes contacts, companies, pipelines, activities, products
  and notes, so 50,000 is not a comparable customer-company allowance.
- [Pipedrive usage limits](https://support.pipedrive.com/en/article/usage-limits-in-pipedrive):
  Growth allows 50 automations/company and one synced mailbox/user, while
  contacts are not capped. Its leads/deals limits are another separate metric.
- [Close pricing](https://close.com/pricing): Solo is $19/month monthly with
  10,000 leads; workflow automation starts with Growth at $109/user/month
  monthly ($99 annually). Close's AI credit definitions differ from ours.
- [Brevo plan documentation](https://help.brevo.com/hc/en-us/articles/208589409-About-Brevo-s-pricing-plans):
  Starter starts at $9/month with a 5,000-email/500-contact tier. Its commercial
  meter is email sends rather than workflow starts. Brevo supplies marketing
  delivery infrastructure; our workflows use connected customer mailboxes.
- [Zoho CRM China pricing](https://www.zoho.com.cn/crm/zohocrm-pricing.html):
  Standard is CNY 1,000/user/year and Professional CNY 1,800/user/year. Keep our
  workspace bundle understandable rather than claiming every feature or quota
  is directly comparable with a per-user CRM edition.

Our positioning is an integrated AI-assisted CRM, connected customer email,
product catalogs and sales documents at a predictable workspace price. Upgrade
drivers are team size, useful catalog capacity and automated customer-email
volume. Do not invent paid add-ons or promise unlimited provider sending.
Review real product counts, accepted sends, failures, AI costs and upgrade
rates after 30–60 days before changing prices or introducing add-ons.

The v6 migration also validates preserved v4 entitlements, product-cap
enforcement, calendar reset, reservation/replay behavior and tenant isolation.
Regression fixtures: `tests/workflow-email-limits-database.sql` and
`tests/subscription-discounts-database.sql`, run in rolled-back transactions.

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

New recharges accept a custom positive whole-credit quantity, without a plan
or lifetime recharge cap. Catalog v5 uses the existing $0.001-per-credit
accounting unit. The server reads the ECB USD/CNY reference rates and saves a
private, one-hour pricing snapshot. Only the quantity and final CNY total are
shown in checkout; the database derives the amount and rejects client price
changes. Each order locks its quantity, pricing snapshot and total. Quotes
with missing or stale rates fail closed. Amounts are rounded up once to whole
fen, and each payment must fit the existing integer-fen order format; larger
amounts can be split across recharges. Existing catalog v2 packs retain their
original 3,000-credit / CNY 69 terms and can still settle or refund correctly.

Only an active workspace's owner can purchase a recharge. Credits with the earliest
expiry are consumed first. A refund revokes the corresponding grant without
rewriting its usage history. A top-up neither adds seats nor extends CRM access.
When credit is insufficient, new AI calls stop; ordinary CRM continues while
the workspace subscription is active.

The recharge form includes a discount-code field. Privately provisioned 100%
codes are bound to a specific owner and workspace, have unlimited redemptions,
and remain valid until revoked. Only their SHA-256 hashes are stored; the actual
code is never committed or included in browser bundles. Applying a code checks
current ownership, active membership, verified email and subscription access.
Redemption repeats those checks atomically and records a separate credit grant
and audit row; it does not create a paid Alipay order. Request IDs make retries
idempotent, while a fresh recharge can use the same code again. Discount grants
retain the standard twelve-month expiry and work without Alipay or exchange-rate
availability. Private tables and RPCs are restricted to the service role.
Migration: `20261128024924_account_credit_discounts.sql`; regression fixture:
`tests/credit-discounts-database.sql` (run in a transaction ending in rollback).
`20261128025756_private_discount_verification.sql` uses the existing private
identity verifier so service-role calls work without direct access to auth tables.
When Alipay is disconnected, the payment button opens an unavailable-payment
dialog; it resumes normal checkout once the existing merchant checks pass.

Workspace package checkout also accepts privately provisioned, account-bound
100% subscription codes. These are single-use and expire after 30 days by
default. Applying a code only previews eligibility; checkout rechecks verified
identity, ownership, membership, package limits and code validity. Redemption
atomically consumes the code and activates one selected monthly or annual
period, recording the original catalog price in `discount_amount_fen` and a
zero net `amount_fen`. No Alipay transaction is created. Retries return the same
order without granting another period; existing pending payment quotes cannot
be rewritten. Full-precision accounting and the normal monthly credit refresh
remain in effect. Only code hashes are stored. Migration:
`20261128055927_subscription_discount_checkout.sql`; rollback-only fixture:
`tests/subscription-discounts-database.sql`.

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
All customer-facing AI credit amounts use `formatCredits` to show whole credits
rounded down, with thousands separators and no decimal points. This includes
profile summaries, billing, sidebar balances, activity totals, tooltips and
accessible labels. The sidebar shortcut links to the credit settings. A positive balance below one credit
shows `<1`; fractional usage remains precise in the ledger. Its member-safe
`/api/ai/credits` endpoint derives the actor and workspace from the signed-in
session and returns only credit totals and account availability. It refreshes
after interactive chat and email AI tasks, on focus, and once per minute while
the page is visible. Pending reads are aborted on unmount; a completion during
an in-flight read queues another read so the new deduction is not missed.

Text generation, native Agent tools and native Google web research all enforce
the wallet before contacting the provider, including requests with an injected
history-tracking transport. Already metered transports are reused to avoid
double charging. Native research reserves for opaque search/URL context and
settles SDK token totals plus the reserved search fee.

Complimentary subscriptions are private, server-managed grants rather than paid
orders. Catalog v4 grants apply the selected workspace package's shared capacity
and monthly credits once, without multiplying them by included users. Older
catalog v2 grants retain their existing per-seat terms. Complimentary credits
renew on the China calendar month, and block subscription checkout. Existing
beta credit usage is preserved when its allowance is upgraded. Only the original internal Filazoo workspace
uses the current complimentary Business package: five included users, 15,000
shared monthly AI credits and the standard Business capacity; other workspaces retain
their existing terms. This does not waive hosting or AI provider bills.

Filazoo uses plan-credit-only AI billing: 15,000 shared monthly Business credits,
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

Custom recharge migration:
`supabase/migrations/20261128015303_custom_credit_recharges.sql`.
`supabase/migrations/20261128015429_credit_recharge_pricing_policy.sql` records
the explicit service-role-only pricing policy; browser and tenant roles have no
pricing-table privileges.
`tests/credit-recharge-database.sql` covers arbitrary quantities, repeat and large
recharges, private RPC privileges, quote expiry, immutable pricing, owner checks,
underpayment, payment replay, refunds and historical pack settlement. Run the
fixture in a transaction ending in rollback. The Alipay merchant must still be
activated before live payments are enabled.

Fixed package migration: `supabase/migrations/20261123081854_fixed_workspace_packages.sql`.
The private v4 catalog is frozen; future prices require a new catalog version.
Regression coverage: `tests/package-subscriptions-database.sql`, exercised in a
transaction ending in rollback along with annual and credit-mode coverage.

The subscription comparison lists 30 verified capabilities in
`lib/billing/features.ts`. Categories can be expanded individually or together;
products, orders and billing are open initially. Features are shared across plans,
with explicit labels for AI credit usage, required external accounts and beta tools.
The comparison preserves pricing and quota values from the package catalog.

Social messaging and Shopify/Meta lead capture currently use original-workspace
integration credentials (`lib/data/app-connections.ts` and
`lib/data/workspace-runtime.ts`). They are listed as limited access for existing
enabled workspaces, not as general paid-plan entitlements. Planned integrations
such as calendar connections and Microsoft sign-in are excluded. Lingxing ERP
supports workspace-specific saved credentials and is listed as requiring an account.
