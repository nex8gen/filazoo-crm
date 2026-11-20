# Alipay subscriptions

New email-verified accounts go to `/subscribe`. An owner chooses Starter (¥99/month, 1 member) or Team (¥299/month, 5 members), pays through Alipay's embedded website cashier QR, and enters `/workspaces/setup` after server confirmation. Invitations retain their existing destination. Existing workspaces at migration time retain access. Plans renew through another one-time payment; automatic debit is not enabled.

The existing **Filazoo** and **Filazoo Innovations Inc** workspaces are permanently exempt: no subscription purchase, subscription expiry restriction, or subscription member cap. This exemption is stored on those existing workspace IDs; naming a new workspace “Filazoo” does not grant free access.

## Merchant setup

App ID: `2021007121675450`. RSA2 signing was registered. The signed live transaction-query readiness check on 20 November 2026 returned `40003 / isv.not-online-app / 应用未上线`. The app description was completed and the application was submitted for go-live review on 20 November 2026. Alipay's console now shows **审核中**, with a stated review time of one day. Live payments must remain disabled until approval and merchant activation.

The account center was inspected on 20 November 2026: the currently logged-in developer account is **个人** (personal), with **实名认证：已认证** (real-name verification completed). The owner clarified they have **no company and no Chinese business licence**, including no individual-business licence; only personal ID/passport. This supersedes the earlier statement that the business was registered in China. There is no separate business Alipay account. The licensed-business onboarding route cannot be completed with the currently available documents. Do not use the personal account's PID as an approved website-payment merchant or enable payments without confirming actual product eligibility and signing authority.

Official business registration entry: https://b.alipay.com/page/settle-b/pay-guide?bizChannel=memberprod_register (the legacy enterprise registration URL redirects here). Company certification guidance: https://help.alipay.com/support/help_detail.htm?help_id=425157. The owner should supply company documents, identity verification, banking information and any new passwords directly to Alipay. These details should not be collected in chat or committed to the repository.

The live registration page was opened in Chrome with **企业/个体工商户** selected. The owner approved the initial QR login. The direct-customer-payments draft then exposed mandatory business-licence/electronic-licence authorization fields. Selecting **电脑网站** exposed the requirement that the submitted website have an ICP filing. Company documents and legal consent were not submitted, and no business account was opened. The owner then clarified they have no business licence. The no-licence individual-merchant option is being checked separately; it must not be assumed to support website API payments.

1. Wait for the submitted application's go-live review (审核中) to become approved/已上线. The saved description explains the CRM service, one-month purchases, manual renewal and no automatic debit.
2. Activate **电脑网站支付** for the verified business merchant and this application. This integration uses `alipay.trade.page.pay`, `FAST_INSTANT_TRADE_PAY`, `qr_pay_mode=4`; it does not require or substitute an offline personal collection QR.
3. Obtain the business merchant PID/UID starting `2088`. Set `ALIPAY_SELLER_ID` to that verified recipient.
4. Deploy server-only credentials: `ALIPAY_APP_ID`, `ALIPAY_SELLER_ID`, PKCS8 `ALIPAY_PRIVATE_KEY`, and **Alipay's** `ALIPAY_PUBLIC_KEY` (different from the application's public key). Store private keys as production Secrets. Never add them to `NEXT_PUBLIC_*` or Git. Local file paths may be configured outside the repository.
5. Set `NEXT_PUBLIC_APP_URL=https://crm.filazoosupply.com`. The per-order signed request includes notification URL `https://crm.filazoosupply.com/api/alipay/notify` and return URL `/subscribe/orders/<order UUID>`. The return URL alone never marks a payment as successful. OAuth authorization callback settings are unrelated to payment notifications.
6. After merchant activation is verified, set `ALIPAY_PAYMENTS_ENABLED=true`, redeploy, and complete a real purchase through the normal subscription screen. Verify recipient and amount in Alipay before authorizing payment. Confirm the workspace opens, the order is paid once, and replay does not add a second month. This final financial action belongs to the account owner.

## Boundaries

- Browser clients have no direct table or RPC grants for billing. Routes and actions require a fresh authenticated account and verified ownership.
- The database sets and checks prices, CNY currency, team capacity, ownership, renewal periods, unique merchant/provider transaction IDs, and replay handling. New workspaces start unpaid.
- Signed notifications validate RSA2, app, seller, transaction number, and exact amount. Duplicate form keys and oversized requests are rejected. Failed database commits are not acknowledged.
- Signed transaction queries reconcile delayed callbacks. A database polling lease prevents multiple tabs from repeatedly querying Alipay. Returning from the cashier does not unlock access.
- `requireWorkspaceMember` and the tenant REST pre-request hook enforce active access. Invited users share the workspace subscription. Expiry is checked against database time; no scheduled job is needed to revoke expired access.
- Full refunds (`TRADE_CLOSED`) revoke the affected paid period. Renewals preserve previously purchased days. Plan changes are offered after expiry. No self-service partial refunds or prorated changes are provided.
- Alipay approval and merchant contracts are external prerequisites. With payments disabled, the plans page explains that activation is pending and cannot create a payable order.
- Pausing new payments does not disable validation of already-paid transaction or refund notifications when merchant credentials are configured.

## Verification

Run `node --experimental-strip-types --test tests/alipay-billing.test.ts tests/auth-session-performance.test.ts tests/signup.test.ts tests/signup-verification.test.ts` and the billing API tests. `tests/subscriptions-database.sql` executes integration assertions inside a rolled-back transaction; it creates no lasting accounts, workspaces, or payments. Run TypeScript, lint, production build, and the full test suite before release. The real readiness query uses a nonexistent order and performs no charge.

SQL migrations:

- `20261120072531_workspace_subscriptions_alipay.sql`
- `20261120074058_subscription_confirmation_integrity.sql`

Rollback application deployments only to code compatible with the subscription boundary. Do not drop payment records or remove the tenant gate to resolve a failed merchant setup.
