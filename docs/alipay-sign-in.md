# Alipay sign-in

Alipay authentication is separate from Alipay merchant payments. No seller PID,
payment activation or automatic subscription exemption is used for identity.
The existing Filazoo workspaces keep their grandfathered subscription access.

## Account flow

- `/login` and `/signup` show Alipay alongside enabled Google/Apple options.
- Existing users sign in with email first and use **Settings → Profile → Connect
  Alipay**. Supabase links the verified Alipay identity to the existing account.
  A supplied nickname or email never merges accounts.
- New Alipay identities verify an email at `/auth/email` using an emailed OTP,
  then continue to `/subscribe` (or a previously selected invitation).
- Supabase creates and validates the ordinary app session; existing RLS,
  session revocation, invitation checks and workspace billing gates still apply.

## Integration

Alipay's RSA2 token API is adapted to a Supabase custom OAuth2 provider named
`custom:alipay`. Provider endpoints:

| Setting | URL |
| --- | --- |
| Authorization | `https://crm.filazoosupply.com/auth/alipay/authorize` |
| Token | `https://crm.filazoosupply.com/auth/alipay/token` |
| User information | `https://crm.filazoosupply.com/auth/alipay/userinfo` |
| Alipay authorization callback | `https://crm.filazoosupply.com/auth/alipay/callback` |
| Supabase callback | `https://hukbmbicpdmhoxpkvljz.supabase.co/auth/v1/callback` |

The Supabase provider has PKCE enabled and email optional. Manual identity
linking is enabled. The production site URL and redirect allowlist include
`https://crm.filazoosupply.com`; earlier Vercel URLs are retained.

Only an RSA2-verified `alipay.system.oauth.token` response establishes identity.
Browser state is encrypted and authenticated in a Secure/HttpOnly/SameSite=Lax
cookie. Redirects are fixed, Supabase uses S256 PKCE, and bridge grants are
atomic, one-use and expire in two minutes. Five-minute bridge bearer tokens
are hashed in a service-only RLS table. Alipay access/refresh tokens, personal
IDs, nicknames and avatars are not stored. Grants older than one day are
removed during subsequent successful callbacks.

The stable subject is an HMAC of the application ID and the verified app-scoped
Alipay open ID (legacy user ID only when no open ID is returned). Keep
`ALIPAY_OAUTH_SUBJECT_KEY` stable; changing it creates a different identity.
Moving between Alipay apps or ID schemes requires an explicit identity
migration, not automatic account merging.

## Activation status (2026-11-20)

App `2021007121675450` has registered RSA2 keys. Its last observed status was
under review. The owner has only a personal Alipay account and has deferred
business onboarding. Website-login eligibility and permission approval have
not been verified. The browser controller was stopped with Escape, so the
Alipay console callback could not be configured or checked during this task.

The Supabase provider is registered **disabled** and production
`ALIPAY_LOGIN_ENABLED=false`; the visible button explains that activation is
pending. No real Alipay sign-in or consent has been claimed as successful.

To activate:

1. In the Alipay developer console, check the app's website/user authorization
   capability and approval requirements. Use the actual account type; do not
   enter invented company information. Complete any owner consent directly.
2. Set **授权回调地址** to the Alipay callback above. This is distinct from
   payment return/notification URLs and Supabase's callback.
3. Enable the existing `custom:alipay` provider and set production
   `ALIPAY_LOGIN_ENABLED=true`, then deploy. Keep merchant payments disabled.
4. Verify owner consent → callback → Supabase session → email OTP for a new
   account; separately verify linking and repeat login to an existing account.
   Confirm the Filazoo workspace remains unrestricted.

Server-only `ALIPAY_OAUTH_CLIENT_SECRET` and `ALIPAY_OAUTH_SUBJECT_KEY` are
stored as production Vercel Secrets and locally outside the repository under
the existing restricted Alipay secrets directory. RSA keys are reused without
depending on merchant settings. No secrets belong in `NEXT_PUBLIC_` variables.

Verification: `tests/alipay-auth*.test.ts`, `tests/alipay-email.test.ts` and
`tests/alipay-auth-database.sql` cover state tampering, redirect restriction,
RSA verification configuration, PKCE, replay/expiry, database isolation and
email-account binding. Hosted SQL checks run in a rolled-back transaction.

Primary references: [Supabase custom OAuth providers](https://supabase.com/docs/guides/auth/custom-oauth-providers),
[Alipay website authorization](https://developer.alibaba.com/docs/doc.htm?articleId=105942&docType=1&treeId=193),
[official Alipay Node SDK](https://github.com/alipay/alipay-sdk-nodejs-all).
