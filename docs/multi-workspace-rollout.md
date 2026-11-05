# Multi-workspace CRM rollout

Implemented: email/password signup, verified-email workspace creation, workspace selection, per-workspace administrator/operator/BD manager/viewer roles, team invitation links and optional SMTP delivery, invitation revocation, ownership transfer, leaving/removing members, and tenant-scoped CRM data.

## Account and onboarding experience (November 5, 2026)

- Sign-in and sign-up use `components/ui/auth-section-1.tsx`, adapted from the supplied split-screen Paper GrainGradient design, with responsive forms, password visibility, and reduced-motion support.
- Registration collects first/last name, email, password, required terms consent and an optional product-updates preference. Workspace details are collected after verification, so invited users do not have to create an unrelated workspace.
- `/signup/verify` accepts a six-digit email OTP, handles invalid/expired codes, and supports resend with a 60-second cooldown. Supabase validates the code with `verifyOtp({ email, token, type: "email" })`; successful verification establishes the session, clears the pending cookie, and continues onboarding or the original invitation. A short-lived HttpOnly cookie remembers the email and safe continuation, never the password or code.
- `lib/standalone-routes.ts` matches auth and onboarding route families at segment boundaries. Nested routes such as `/signup/verify` and `/workspaces/new` never render the CRM sidebar, search, notifications, or AI controls.
- `/workspaces/new` creates an empty, private workspace. `/workspaces/setup` offers optional team, email and customer setup and links into the actual CRM settings. The old `/setup` infrastructure checklist now routes here.
- `/terms` and `/privacy` are public. Access-denied and auth-error screens provide workspace selection, account creation and verification/recovery paths.
- Google/Apple buttons are shown only when enabled in Supabase's public Auth settings. Enable/configure each provider and callback URL in Supabase before offering it. No provider credentials are stored in the UI.
- Empty email workspaces no longer fall back to Filazoo's sample product catalog.
- Next.js development filesystem caching is disabled to avoid the 16.4 persisted-HMR reload loop (vercel/next.js#100267). Production build caching remains enabled.

The hosted Supabase **Confirm sign up** email template was changed and read back on November 5, 2026: subject `Your Filazoo verification code`, with the branded `{{ .Token }}` code email instead of a confirmation link. The reusable template is `supabase/templates/confirmation.html`. Custom Auth SMTP remains a separate required delivery setting; the built-in sender is unsuitable for unrestricted public signup.

This UI release does not install the pending tenancy migration. The live database was checked during this update: `workspaces`, `create_crm_workspace`, and `read_workspace_session` are still absent. Install the existing migration together with the matching application release before advertising live self-service workspace creation.

## Current deployment state

The schema migration is **not installed**. Automatic approval review rejected the live schema/role/cron change. Existing accounts use the existing `read_crm_session` function while that upgrade is pending, fixing the missing `read_workspace_session` runtime error without changing the live database. New workspace creation returns an explicit rollout-pending message until installation.

Apply `supabase/migrations/20261105021644_multi_workspace_tenancy.sql` together with the matching application release. Do not leave an older application running against the upgraded schema: primary keys, unique constraints and upsert conflict targets now include `workspace_id`. Keep a normal database backup and deploy during a maintenance window appropriate for the data volume; the migration takes table locks. Existing data is assigned to the original Filazoo workspace. No customer rows or Auth accounts are deleted.

## Database design

- `workspaces` owns the organization identity; composite membership permits one account in multiple teams.
- All existing public CRM tables receive an indexed, non-null `workspace_id` and tenant-scoped keys and foreign keys. `ON DELETE SET NULL` preserves the workspace column.
- `createSupabaseAdmin()` resolves the current workspace from a verified, live session and a validated membership. Cookie values and user-editable metadata never grant access.
- PostgREST's `crm_tenancy.pre_request` downgrades server record queries into the non-bypass-RLS `crm_workspace_server` role. Every table and existing invoker RPC then enforces workspace RLS. A service request without a workspace header remains limited to the original workspace for existing signed webhooks.
- The separate control client is for identity, workspace discovery/provisioning and invitation capabilities. It must never be used to serve arbitrary CRM queries.
- Customer portal requests select a workspace only after verifying an invoice QR capability or an unexpired opaque portal session. Inner handlers still check invoice identity, credential version and portal permissions.
- Background HTTP workers iterate through workspaces in independent AsyncLocalStorage contexts. Workspace switching performs a full document navigation to clear retained client data.
- Environment-level Meta/Shopify/ERP integration credentials remain exclusive to the original workspace. New workspaces connect their own email and ERP. Additional social/commerce provider onboarding is not implemented in this change.
- Avatar/profile identity remains account-level. Workspace roles and member display names are workspace-level; administrators cannot edit another account's global login email or password.

## Supabase Auth settings

Before opening public signup, verify in the existing Supabase project's Authentication settings:

1. Email/password signup is enabled and email confirmation is required.
2. Site URL is the public application origin (`NEXT_PUBLIC_APP_URL`). Allow the deployed `/auth/callback` URL and the development callback URLs you actually use.
3. Configure production Auth SMTP delivery and appropriate provider rate limits. Signup/recovery email is sent by Supabase Auth; team invitations use the workspace's connected mailbox or provide a secure shareable link.
4. The **Confirm sign up** template must contain `{{ .Token }}` and no confirmation link; use `supabase/templates/confirmation.html`. Keep email OTP length at six digits to match the verification form. Recovery continues to use its own link template and `/update-password` destination.
5. Keep the service/secret key server-side. Use the existing publishable/anon key for the Auth client. `AUTH_REQUIRED=false` no longer disables protection of configured CRM routes.

## Validation evidence

`tests/workspace-tenancy-database.sql` exercises two synthetic workspaces, duplicate domains/SKUs, SELECT/UPDATE/DELETE isolation, forged inserts, cross-workspace foreign keys, assignment isolation, owner protection, invitation email matching/replay prevention, multi-membership, leaving, ownership transfer and service-role downgrading. The core migration and these assertions were run together in a transaction and rolled back; no fixtures were retained. The final database-cron wrapper additions still require staging/rollout verification after approval.

The focused Node tests also cover code validation, provider errors and rate limits, cookie cleanup, invitation continuations, safe redirects, resend behavior, standalone route boundaries, and the OTP email template. The full local suite passed 1,246 tests with zero failures; lint and the production build (including TypeScript) passed. Hosted email delivery and live signup-to-new-workspace verification require custom Auth SMTP and the pending tenancy migration.
