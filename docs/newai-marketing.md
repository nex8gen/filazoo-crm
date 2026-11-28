# NewAI marketing website

The public marketing site is live at `https://www.newai.xin`. Signup, login, and legal links use `https://app.newai.xin`. It is also available at `https://app.newai.xin/marketing`; preview locally at `http://localhost:3000/marketing`.

Production deployment: `dpl_AjTemA7KdGUecUgGmozQWtYFwKJh`, built from commit `366fa99c` plus the selected reference-style marketing changes and actual CRM sample-data exports. Both the app and www aliases point to this deployment. Vercel reports an auto-renewing SSL certificate for www, and public HTTPS checks passed on 28 November 2026.

## Content and design

`components/marketing/marketing-site.tsx` exports the current design from `reference-marketing-site.tsx`. The user-supplied reference informed the white canvas, bold black sans-serif typography, black buttons, fine orbit lines, floating connection icons, violet illustration, and product card layouts. The NewAI logo and actual CRM interfaces remain the product identity. `marketing-data.ts` retains the 16 feature groups and FAQs; Beta labels and access-control explanations are preserved. There are no invented customer endorsements, testimonials, or usage statistics.

The hero uses a compact, expandable actual-CRM tour. Additional email, workflow, and purchase-order previews use the same isolated sample-data exports. The three-step "How it works" section has keyboard-accessible tabs. The full feature directory retains category filters, and small-screen navigation and FAQs remain functional.

The product tour now displays the actual CRM interface, rendered from the production HomeWorkspace, EmailInboxWorkspace, FlowBuilder, PurchaseOrderRegister, WorkspaceSidebar, and WorkspacePageHeader components. `components/marketing/crm-demo-source.tsx` supplies synthetic companies, email messages, orders, team members, workflow steps, and an AI credit balance. It does not read a database or mailbox. The source route `/marketing/demo-source` is available only on localhost in development and returns not-found in production.

`components/marketing/crm-product-tour.tsx` switches between four static exports in `public/marketing/crm-demo/`. They retain the CRM's actual markup, fonts, styles, sidebar, and controls. The scaled desktop preview has keyboard-accessible tabs and a full-size link. Exports contain no scripts, navigable CRM links, or live form actions. Their iframe and HTTP Content Security Policy disable scripts and API connections; controls are read-only. Only sample data is published.

To regenerate after changing the real CRM, run the local development server, then `node --experimental-strip-types scripts/export-marketing-crm-demo.mjs`. The exporter downloads only local styles/fonts, resolves streamed markup without executing scripts, and applies the shared `formatCredits` helper to the fixture credit balance. It rejects non-local source servers and external resource URLs.

Active page styles are scoped in `components/marketing/reference-marketing.module.css`, with CRM tour chrome in `crm-product-tour.module.css`. The page reuses the existing NewAI vector logo. `app/marketing/page.tsx` defines the title, description, canonical URL, and sharing metadata. The sharing image source and PNG in `public/marketing/` match the new black, white, and violet design.

## Domain routing

`proxy.ts` handles the exact `www.newai.xin` and `newai.xin` hosts before staff authentication or customer portal lookup. The www root rewrites to `/marketing`, while the apex redirects permanently to www. The public host serves its own robots file and sitemap. Account/legal paths redirect to the app; other non-asset paths return 404. Local and platform-host previews at `/marketing` bypass staff authentication only for that exact public page.

Both domains are attached to the existing `filazoo-crm` Vercel project. Vercel reported external authoritative DNS at `dns9.hichina.com` and `dns10.hichina.com`. The following records were recommended by Vercel on 28 November 2026:

| Type | Host | Value |
| --- | --- | --- |
| CNAME | www | a5d0417ca761d3f9.vercel-dns-017.com |
| A | @ | 216.150.1.1 |

The www CNAME became active during deployment and Vercel now reports `misconfigured: false`; HTTPS was verified publicly. DNS changes were not made by this implementation. The apex A record enables the bare-domain redirect; Vercel still reported it missing at the last check. Add it in Alibaba Cloud DNS if the bare `newai.xin` domain should also work.

## Verification

- `npx tsc --noEmit --incremental false`
- `npm run build`
- `node --experimental-strip-types --test tests/marketing-routing.test.ts tests/marketing-crm-demo.test.ts tests/portal-domains.test.ts` — 18 passing checks.
- React/DOM smoke checks exercised all product views, all feature filters, mobile navigation, FAQ disclosure, internal anchors, signup/login links, and Beta labels.
- HTTP requests with the www Host header returned the marketing page, robots file, and sitemap; the apex returned a 308 redirect; an app API on the marketing host returned 404.

The redesign was visually inspected in Chrome on desktop: the hero, violet product card section, workflow preview, and feature grid rendered successfully. The inspection exposed an initially hidden canvas layer in the workflow export; the exporter now resolves that initial measurement state for its fixed desktop viewport, and the sample workflow uses valid action settings. A regression check requires visible workflow nodes and rejects validation errors. Small-screen behavior, preview scaling, category filters, workflow steps, expandable demo, mobile navigation, FAQs, and internal links passed React/DOM smoke checks. Mobile screenshots were not inspected.

The release checkout at `tmp/newai-marketing-release` contains the committed application base plus only the marketing-related changes. It excludes unrelated work in progress from the main checkout.
