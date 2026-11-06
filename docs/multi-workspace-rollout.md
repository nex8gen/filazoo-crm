# Multi-workspace CRM rollout

Implemented: email/password signup, verified-email workspace creation, workspace selection, per-workspace administrator/operator/BD manager/viewer roles, team invitation links and optional SMTP delivery, invitation revocation, ownership transfer, leaving/removing members, and tenant-scoped CRM data.

## Account and onboarding experience (November 5, 2026)

- Sign-in and sign-up use `components/ui/auth-section-1.tsx`, adapted from the supplied split-screen Paper GrainGradient design, with responsive forms, password visibility, and reduced-motion support.
- Registration collects first/last name, email, password, required terms consent and an optional product-updates preference. Workspace details are collected after verification, so invited users do not have to create an unrelated workspace.
- `/signup/verify` accepts the email OTP, handles invalid/expired codes, and supports resend with a 60-second cooldown. The live project generates **eight-digit** codes; the form accepts numeric OTPs from six to ten digits so supported provider settings do not truncate the input. Supabase validates the code with `verifyOtp({ email, token, type: "email" })`; successful verification establishes the session, clears the pending cookie, and continues onboarding or the original invitation. A short-lived HttpOnly cookie remembers the email and safe continuation, never the password or code.
- `lib/standalone-routes.ts` matches auth and onboarding route families at segment boundaries. Nested routes such as `/signup/verify` and `/workspaces/new` never render the CRM sidebar, search, notifications, or AI controls.
- `/workspaces/new` creates an empty, private workspace. `/workspaces/setup` offers optional team, email and customer setup and links into the actual CRM settings. The old `/setup` infrastructure checklist now routes here.
- `/terms` and `/privacy` are public. Access-denied and auth-error screens provide workspace selection, account creation and verification/recovery paths.
- Google/Apple buttons are shown only when enabled in Supabase's public Auth settings. Enable/configure each provider and callback URL in Supabase before offering it. No provider credentials are stored in the UI.
- Empty email workspaces no longer fall back to Filazoo's sample product catalog.
- Next.js development filesystem caching is disabled to avoid the 16.4 persisted-HMR reload loop (vercel/next.js#100267). Production build caching remains enabled.

The hosted Supabase **Confirm sign up** email template was changed and read back on November 5, 2026: subject `Your Filazoo verification code`, with the branded `{{ .Token }}` code email instead of a confirmation link. The reusable template is `supabase/templates/confirmation.html`. With the user's explicit approval, custom Auth SMTP was enabled using the existing `raul@filazoo.com` sender, `smtphz.qiye.163.com:465`, and its saved credential. Supabase displayed a successful settings-save confirmation. A direct SMTP connection check from the local machine timed out before authentication; actual inbox delivery is not yet verified.

On November 6, 2026, the production application and tenancy migration were released together. `workspaces`, `create_crm_workspace`, and `read_workspace_session` are installed, and the actual production creation form successfully continued to `/workspaces/setup` and the CRM dashboard with a synthetic verified account. The temporary account and workspace were removed after verification. Actual inbox delivery through Auth SMTP remains a separate unverified check.

## Current deployment state

The schema migration is **installed** as Supabase version `20261106010757` (`multi_workspace_tenancy`). The earlier approval-review block was resolved by the user's request to complete the fix. The prepared migration was rehearsed in rollback-only transactions against the current schema, including the final cron wrappers, before installation. Row counts for every existing public table were checked within the rollout transaction. Existing accounts and all original CRM rows remain in the Filazoo workspace.

The local migration file is `supabase/migrations/20261106010757_multi_workspace_tenancy.sql`, renamed to match the installed migration-history version (the prepared file was previously named `20261105021644_multi_workspace_tenancy.sql`). Do not reapply it. Production deployment `dpl_nPADbWrohpcmL2cfN9L78MFh5hgE` is READY and promoted. It uses commit `29278a93d5c5defde1fb52690b7ef2d8742e5a8b` plus the reviewed auth/OTP and webhook-conflict compatibility changes; unrelated local edits were excluded. Do not roll back to application code that lacks tenant scoping: primary keys, unique constraints and upsert conflict targets now include `workspace_id`.

`workspaceFetch` preserves legacy upsert targets before the upgrade. After the upgrade, signed webhooks without a viewer retry only a PostgreSQL `42P10` rejected conflict target using the composite key. The failed statement has not executed; successful writes, permission errors and server failures are never replayed. Unscoped signed integrations remain bound to the original workspace by the database pre-request hook.

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
4. The **Confirm sign up** template must contain `{{ .Token }}` and no confirmation link; use `supabase/templates/confirmation.html`. The live project uses eight-digit OTPs; the form also supports valid configured lengths from six to ten digits. Recovery continues to use its own link template and `/update-password` destination.
5. Keep the service/secret key server-side. Use the existing publishable/anon key for the Auth client. `AUTH_REQUIRED=false` no longer disables protection of configured CRM routes.

## Validation evidence

`tests/workspace-tenancy-database.sql` exercises two synthetic workspaces, duplicate domains/SKUs, SELECT/UPDATE/DELETE isolation, forged inserts, cross-workspace foreign keys, assignment isolation, owner protection, invitation email matching/replay prevention, multi-membership, leaving, ownership transfer, service-role downgrading, and empty-workspace cron behavior. The assertions passed in rollback-only rehearsals and again against the installed schema. No database fixtures were retained. The installed schema has no unscoped CRM tables or public tables without RLS. The only security-advisor notice is informational: `workspace_invitations` intentionally has no browser RLS policy because it is a service-only control-plane table, with browser grants revoked.

The isolated November 6 release passed **1,250 Node tests**, scoped lint and the production build with TypeScript. Its 23 focused signup, verification and tenancy tests also passed. A live production HTTP check verified an emailed-code-style OTP without sending mail, submitted the actual rendered creation form, observed the workspace cookie and redirect, loaded Get started and the analytics dashboard, confirmed an empty customer list and owner/default-policy creation, and rejected a forged selection of the original workspace. The synthetic session was revoked and both fixture account and workspace were removed with zero-count readbacks. The production error/fatal-log scan was empty. See `docs/audit-evidence/workspace-tenancy-rollout-20261106.json` for the current evidence; November 5 evidence files record the earlier blocked state and concurrent working-tree test failures.
