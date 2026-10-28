# Authentication optimization — 28 October 2026

The CRM now checks a verified login session and current workspace membership in one fresh database snapshot. This replaces the sequential remote Auth user lookup and membership lookup on the normal application path. The AI icon's original star/blob/circle morph, rotation, scaling and twinkle are also restored using native SVG animation.

## Authentication path

1. Supabase's `getClaims()` verifies the access-token signature and expiry. Asymmetric public signing keys are cached by the SDK; a cold key lookup or token refresh can still need a network request. Symmetric signing configurations can still use the SDK's Auth-server fallback.
2. The application checks the token subject/session UUIDs, project issuer, authenticated audience and authenticated token role. User metadata cannot grant a workspace role.
3. A server-only `read_crm_session` RPC checks the session belongs to that user and still exists, its explicit expiry has not passed, and the Auth user is neither deleted nor currently banned. It returns current profile preferences/avatar fields and current workspace membership in the same database query.
4. The existing application helpers enforce activated membership and the operation's allowed roles. Inactive or missing membership remains usable only as an authenticated identity for invitation/account flows, not as CRM access.

There is no shared login or permission cache. React's request-scoped render memoization lets the shell, page and data helpers share a snapshot within a Server Component render. Subsequent server requests recheck the live session and role. Existing browser navigation caches are separate from these checks.

The elevated Auth-table reader lives in the non-exposed `crm_auth_private` schema, has a fixed empty search path, verifies the service role, and returns only the required fields. Its exposed wrapper uses security invoker. Both functions are executable only by the existing server service role; anonymous and authenticated clients have no execute permission. No Auth-table permissions or CRM RLS policies were opened to browser clients.

If the additive migration is not installed in another environment, only missing-function errors use the previous live `getUser()` plus membership check. Invalid tokens, revoked sessions, denied roles, ordinary database errors and permission errors never become an authorization success or trigger that compatibility fallback.

## Verification

- `npm run verify`: lint, **665 tests passed / 0 failed**, production TypeScript build and all 11 production-shell JavaScript budgets passed.
- Added eight focused application tests for verified identity, current profile metadata, wrong-project/invalid claims, revoked-session denial, role changes, render deduplication, migration compatibility and fail-closed backend errors.
- Ran `scripts/verify-crm-session.sql` against the connected database. It creates isolated fixture users/sessions inside a transaction and rolls everything back. Assertions passed for valid sessions, another user's session, missing/revoked/expired sessions, banned/deleted accounts, changed/inactive/missing membership, metadata field filtering and service-only grants.
- An actual anonymous HTTP RPC call returned **401 / permission denied (`42501`)**, with no user data.
- The Supabase security advisor reported no new findings after the migration. Existing notices remain unchanged: 48 server-access-only tables with RLS and no client policies, and disabled leaked-password protection. The latter is unrelated to this optimization; [Supabase's existing-notice guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- Signed-in browser checks passed for Companies, company profile and Settings. No browser console errors were captured.
- The AI icon has six active SVG animation elements. Its path geometry changed over a 600ms observation, confirming it is animating. Reduced-motion emulation correctly showed the static glyph and hid the animated group; the emulation was reset afterward.

## Measurements and limits

The local production trace captured one `read_crm_session` call per checked page/API request, with **zero `/auth/v1/user` calls** in the normal new path. Staff-avatar `/auth/v1/admin/users/...` reads are separate cosmetic work and are not authentication validations.

| Observed navigation | Ready observation | Document response end | Session RPC HTTP wait |
| --- | ---: | ---: | ---: |
| Company profile, first timed load | 9,857ms | 9,676ms | 6,496ms |
| Companies | 2,553ms | 2,290ms | 1,330ms |
| Company profile, repeat | 1,467ms | 1,446ms | 262ms |
| Settings | 457ms | 362ms | 321ms |
| Company profile, second repeat | 2,422ms | 2,392ms | 1,034ms |

These are a small set of signed-in Chrome observations against a local production server in China querying US East Supabase. They include browser observation overhead, and are not Web Vitals or production guarantees. The slow first result is retained: the network can still delay the single required call. This implementation removes a sequential backend round trip; it does not guarantee a fixed page-load time.

## Release state and maintenance

The additive migration `20261028080525_consolidated_crm_session.sql` was applied to the connected Supabase project and its regression SQL passed. The application code is verified locally and has **not been deployed to Vercel**. Existing deployed code does not call the new function and remains compatible.

Deploy the function before application code in other environments. Keep the session SQL assertions when upgrading Supabase, since the private reader intentionally checks Auth's session/user tables. To roll back, restore the prior application code; the unused additive functions can remain until removed through a reviewed migration. No existing user/session records were changed permanently by verification.

The native SVG icon retains the same five shape keyframes and state-specific duration (idle 4s, thinking 2.4s). It avoids adding a global motion-library import, and the bundle budgets still pass with the animation restored.

References: [Supabase token verification](https://supabase.com/docs/reference/javascript/auth-getclaims), [Supabase sessions and revocation](https://supabase.com/docs/guides/auth/sessions), and the installed Next.js 16.4 authentication/DAL guide in `node_modules/next/dist/docs/01-app/02-guides/authentication.md`.
