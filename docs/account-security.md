# Account security

Security and login (`/settings/security`) includes authenticator enrollment and
removal, passkey registration/rename/removal, and a list of account sessions with
device/browser, network address, login time, activity, and the current device.
Users can end one session, other sessions, or every session with confirmation.
Times use UTC so the initial server render matches browser hydration.

## Authentication and authorization

Supabase Auth owns TOTP secrets, challenges, WebAuthn credentials, signature
verification, rate limits, and session issuance. Authenticator setup is inactive
until a correct six-digit code is verified. Removal requires a fresh code from
the selected authenticator. A second authenticator can serve as a backup.

`read_secure_workspace_session` checks live account/session ownership and MFA
enrollment in the same request as current workspace membership. Every account
and workspace reader denies data while a verified factor exists and the signed
token has not reached AAL2. The data client also refuses its legacy workspace
fallback for pending MFA. Missing migrations or missing MFA state fail closed.
Password recovery and social/passkey sign-ins retain the MFA requirement.

Only the server service role can invoke account-security RPCs. Form inputs never
choose the user or current session: both come from signature-verified claims.
Device revocation checks a live, verified caller and limits all deletions to that
account. Removing `auth.sessions` invalidates refresh tokens; CRM readers also
reject still-unexpired access tokens on the next request. Account settings span
that user's devices across workspaces without exposing any other user's devices.

Device names are approximate user-agent labels. The UI shows IP addresses rather
than inventing geographic locations or marking an unverified device as trusted.

## Passkey configuration

The connected project has passkeys enabled with display name `Filazoo`, relying
party ID `crm.filazoosupply.com`, and origin `https://crm.filazoosupply.com`.
`NEXT_PUBLIC_PASSKEY_ORIGIN` must match that origin; its default is this production
address. Passkeys are cryptographically bound to this relying party. Do not
change it after users enroll without planning re-enrollment.

Localhost and Vercel preview addresses can still use password and authenticator
sign-in. Passkey creation/sign-in explains the required production address on
those hosts. To test local browser passkeys, use a separate Supabase development
project with RP ID `localhost`, origin `http://localhost:3000`, and matching
`NEXT_PUBLIC_PASSKEY_ORIGIN`. Do not change production RP settings for a local test.

## Validation

Run the normal test suite and production build. The database regression script
`tests/account-security-database.sql` uses a rollback transaction to verify
ownership, privileged RPC grants, MFA enforcement, expiration, banned users, and
revocation. It leaves existing users and sessions untouched.

For an explicit live provider check:

```powershell
node --env-file=.env.local --experimental-strip-types scripts/verify-account-security.ts
```

It creates one disposable confirmed account, verifies real TOTP enrollment and
AAL transitions, generates an in-memory ES256 WebAuthn credential, registers it,
signs in using a valid signature, rejects challenge replay, renames and removes
the credential, and checks session revocation. The account and credentials are
removed in `finally`. It never prints or saves passwords, secrets, or tokens.
Browser-native biometric/PIN prompts still require a supported device and the
configured production origin.

`scripts/verify-security-routes.ts` also checks the actual HTTP settings and MFA
pages against a local production server on port 3108 (override with
`SECURITY_VERIFY_APP_URL`). It creates and removes an isolated account and
workspace, and verifies server rendering and the AAL1/AAL2 access boundary.
This explicit live route check also requires an authenticated Supabase CLI so
its disposable workspace can be removed atomically with all default runtime state.

Validation on 2026-11-27 passed production build, type-checking, lint, the targeted
security/authentication regressions, the rollback database regression, 12 live
provider checks, and five local production HTTP checks. No verification accounts
remain. Native biometric/PIN prompts were not exercised because browser automation
was unavailable. Repository-wide checks also report unrelated portal-routing and
translation-coverage failures, and existing bundle-budget overruns on other pages.
