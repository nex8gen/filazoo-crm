# Customer portal custom domains

Workspace admins can open **Customer portal → Manage domain**, enter an apex
domain or subdomain they own, copy the exact DNS records, and check the
connection. One custom domain is supported per workspace. The existing CRM
portal address remains usable.

## Installation

Apply `supabase/migrations/20261117013852_customer_portal_domains.sql` before
deploying the application changes. The table is isolated by workspace RLS;
public and authenticated browser clients have no direct grants. Only the
server's control client can resolve a hostname across workspaces.

Set the following server environment variables, then deploy:

- `PORTAL_VERCEL_TOKEN`: a Vercel API token for the installation's hosting team,
  with access to manage project domains. Store it as a Secret; never use a
  `NEXT_PUBLIC_` name or commit its value.
- `PORTAL_VERCEL_PROJECT_ID`: the shared production Vercel project ID. On Vercel,
  the automatically supplied `VERCEL_PROJECT_ID` can be used instead.
- `PORTAL_VERCEL_TEAM_ID`: the team owning that project, or `VERCEL_TEAM_ID`.
- `NEXT_PUBLIC_APP_URL`: the standard CRM address, which must remain accessible.

The local linked project is `filazoo-crm`, project ID
`prj_8FpTI4sEU5vUDrochgFpT3IjCXCn`, team ID `team_TuvssrxhHF8qgyVEckWNUiBq`.
The application never reuses a developer's CLI credentials or the short-lived
AI Gateway OIDC token for domain management. An authenticated editor sees an
explicit unavailable state until domain hosting is configured. Serving an
already connected domain does not require the management token.

The verification server needs working outbound DNS and TCP port 443. The local
agent environment refused raw DNS queries during the live certificate probe;
that probe could not confirm a real certificate here. Network failures keep a
domain pending rather than activating it. Run a real DNS and certificate check
from the deployment environment before accepting the first customer domain.

Use a separate Vercel project and database for domain tests in previews.
Pointing preview credentials at the production project would mutate real
production domain assignments. There are no domain purchases or registrar
transfers in this feature.

## Connection lifecycle

1. Validate and normalize a publicly registrable hostname, including IDNs.
   Reject URLs, IPs, private suffixes, wildcard hosts, and CRM/deployment hosts.
2. Reserve the hostname globally and store a fresh workspace-specific TXT
   challenge. DNS routing records come from Vercel's current domain config,
   rather than a hard-coded IP or CNAME.
3. On **Check connection**, verify the installation's TXT challenge before
   adding the domain to the project. If Vercel requires another TXT challenge,
   show that record too.
4. Mark the domain connected only after Vercel reports verified ownership and
   valid DNS configuration, and a bounded TLS handshake verifies its HTTPS
   certificate. The handshake pins a resolved public IPv4 address and sends no
   HTTP request or customer credentials. IPv6-only certificate probes remain
   pending until IPv4 is available.
5. Route the custom hostname to the customer surface only. Customer API
   requests independently match the invoice/session's workspace to the domain.
   No staff pages or legacy QR lookup routes are exposed on custom hosts.
6. Newly generated portal links and invoice PDF QR codes use the connected
   custom origin. The signed credential stays in the URL fragment. Existing
   standard links continue to work and sessions are host-only cookies, so a
   customer may need to reopen their signed invoice link on a new domain.

The root URL shows a branded welcome explaining how to open a signed invoice
link. A valid session on that host returns the customer to its invoice. This
does not introduce an email-only login or expose a customer directory.

Disconnect first disables routing and new links, then removes the Vercel
assignment, then releases the reservation. Failed removals stay in a visible
retryable state. A database lease prevents verification and removal from racing.
If a domain is disconnected, previously generated custom-domain links stop
working; standard links and freshly generated links continue to work.

Checks run when an admin clicks **Check connection**; there is no background
DNS monitor. Keep both the routing and ownership records in place.

## Verification

Run the portal-domain tests, customer portal and invoice QR tests, TypeScript,
lint, and the production build. A real connection additionally requires a
user-owned test domain, DNS access, the server token, and deployment of this
code. Do not report a domain live based only on the settings UI or mocked tests.

Provider references: [add a project domain](https://vercel.com/docs/rest-api/projects/add-a-domain-to-a-project),
[verify a domain](https://vercel.com/docs/rest-api/projects/verify-project-domain),
[current DNS configuration](https://vercel.com/docs/rest-api/domains/get-a-domain-s-configuration),
[remove a domain](https://vercel.com/docs/rest-api/projects/remove-a-domain-from-a-project).
