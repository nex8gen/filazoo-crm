# WeChat sign-in

WeChat is shown on `/login` and `/signup`. It stays disabled until the server has
approved app credentials and `WECHAT_LOGIN_ENABLED=true`. Activation status is
included in the button's accessible description, without a visible message below it.
As of 2026-11-28 the owner does not yet have an approved WeChat website app.
Live QR consent and repeat login therefore remain unverified.

## Owner setup

1. Open [WeChat Open Platform](https://open.weixin.qq.com/), register or sign in,
   and complete the developer verification requested by WeChat using your actual
   organization details. Eligibility and any fees are determined by WeChat.
2. Under **管理中心 → 网站应用**, create a **website application** for NewAI.
   Submit the site's actual name, website URL, description, icon, and any
   ownership documents WeChat requests. Request the **微信登录** capability and
   wait for approval. A Mini Program, payment merchant account, or Official
   Account AppID cannot replace this website app.
3. Set **授权回调域** to the hostname of the public CRM application, without a
   protocol or path. For `https://crm.filazoosupply.com` this is
   `crm.filazoosupply.com`. The callback route is
   `https://crm.filazoosupply.com/auth/wechat/callback`.
   If the CRM domain changes, use the hostname from `NEXT_PUBLIC_APP_URL` instead.
4. Obtain the approved app's **AppID** and **AppSecret**. Configure the values as
   server-only `WECHAT_APP_ID` and `WECHAT_APP_SECRET` locally and on the deployment.
   Do not paste AppSecret into chat or add it to source control.

## Deployment setup

The database migration `20261128064716_wechat_oauth_bridge.sql` creates the private
bridge table and atomic redemption function. It was applied to the connected CRM
Supabase project on 2026-11-28, and the rolled-back database checks passed.
Apply it to any separate environment before registering the provider. Do not
push unrelated pending migrations as part of this setup.

Set these server environment variables (see `.env.example`):

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Public HTTPS CRM URL matching the approved callback domain |
| `WECHAT_APP_ID` | Approved website AppID, beginning `wx` |
| `WECHAT_APP_SECRET` | Website AppSecret |
| `WECHAT_OAUTH_CLIENT_SECRET` | Independent random 32-byte base64url secret |
| `WECHAT_OAUTH_SUBJECT_KEY` | Another independent random 32-byte base64url secret |
| `WECHAT_LOGIN_ENABLED` | `false` during setup; `true` when approval and deployment are ready |

Generate the two independent random secrets with Node's `crypto.randomBytes(32)`
and save their base64url values in your secret manager. Keep the subject key stable:
changing it changes users' WeChat identities. AppSecret rotation does not require
changing either bridge secret. Keep all secrets out of `NEXT_PUBLIC_` variables.

After deploying the routes and matching secrets, register the Supabase provider:

```powershell
node --env-file=.env.local scripts/setup-wechat-login.mjs
node --env-file=.env.local scripts/setup-wechat-login.mjs --check
```

The script creates or updates only `custom:wechat`, preserves other providers,
checks for the database table, and never prints secrets. Set
`WECHAT_LOGIN_ENABLED=true` in the deployment and local setup environment when
approved, rerun the setup script, and deploy. The provider has S256 PKCE and
`email_optional=true`. Supabase's redirect allowlist must include the CRM's
`/auth/callback` URL. Enable Supabase **manual identity linking** for existing accounts.

## Account behavior

- New identities scan WeChat's hosted QR page, confirm consent, then establish
  an ordinary Supabase session. Because WeChat does not provide verified email,
  the existing email OTP screen finishes account setup before workspace onboarding.
- Existing accounts should first sign in by email, then use **Settings → Security
  and login → Connect WeChat**. This attaches WeChat to their authenticated account.
  Nicknames, client-supplied OpenIDs, and email strings never merge accounts.
- MFA, invitations, workspace selection, subscription checks, customer assignment
  permissions, and AI data settings continue through the existing session flow.
- This integration uses **website QR login** (`snsapi_login`). It does not add a
  separate Official Account flow inside WeChat's embedded browser.

## Security and verification

Callbacks require a matching encrypted, authenticated, HttpOnly browser cookie
with a ten-minute expiry. Supabase's callback URL is fixed and requires S256 PKCE.
Only WeChat's HTTPS code exchange supplies identity. Its app-scoped OpenID is
HMAC-pseudonymized; UnionID is not substituted later. WeChat access/refresh tokens,
profile details, and raw OpenIDs are not stored. Bridge grants are hashed,
single-use, expire in two minutes, and are redeemed atomically. Bridge bearer
tokens expire in five minutes. The bridge table and RPC exclude public,
anonymous, and authenticated roles. Old grants are pruned on successful callbacks.

Run the automated checks:

```powershell
node --experimental-strip-types --test tests/wechat-auth*.test.ts tests/alipay-auth*.test.ts tests/alipay-email.test.ts tests/signup*.test.ts
```

`tests/wechat-auth-database.sql` verifies role isolation, PKCE, expiry and replay
in a rolled-back database transaction. Before calling this live, verify a real
new-account scan → consent → email OTP → onboarding; existing-account linking
and repeat login; cancelled/expired QR codes; and an account with MFA enabled.

Verification on 2026-11-28: 18 WeChat tests plus 58 existing authentication,
signup, recovery, invitation and account-security tests passed. Targeted ESLint,
TypeScript and the production Next.js build passed. Both auth pages were visually
checked in Chrome. Hosted database checks passed, with no new security-advisor
findings. The setup preflight correctly reports missing WeChat bridge credentials;
the custom provider has not been registered or enabled, and no production app
deployment or real WeChat consent was performed.

References: [WeChat website-login guide](https://developers.weixin.qq.com/doc/oplatform/Website_App/WeChat_Login/Wechat_Login.html),
[Auth.js WeChat adapter source](https://github.com/nextauthjs/next-auth/blob/main/packages/core/src/providers/wechat.ts),
[Supabase custom OAuth providers](https://supabase.com/docs/guides/auth/custom-oauth-providers).
