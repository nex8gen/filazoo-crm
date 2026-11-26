# Customer portal theme system

The customer portal uses one workspace theme library for a public business website and a private customer account. Administrators create and edit drafts, preview both surfaces, and explicitly publish a design. Publishing changes appearance and content settings; it does not change orders, invoices, messages, customer identities, or domain ownership.

## Design references and decisions

| Reference | Relevant pattern | Implementation choice |
| --- | --- | --- |
| [Framer dashboard refresh](https://www.framer.com/updates/dashboard-refresh) | Larger thumbnails and project organization | A responsive draft-card grid with readable names, saved dates, and a secondary actions menu |
| [Shopify theme management](https://help.shopify.com/en/manual/online-store/themes/adding-themes) | Separate published and draft themes; preview before publishing | One published-theme card, independent saved drafts, and a confirmation before changing the customer-facing design |
| [Ghost theme selection](https://ghost.org/help/installing-a-theme/) | Browse, preview, then activate | A separate template chooser; adding a template creates a draft |
| [W3C status messages](https://www.w3.org/WAI/WCAG21/Understanding/status-messages) | Announce outcomes without requiring focus changes | Inline status/error regions, loading labels, and visible retry feedback |

The resulting layout emphasizes the published design first, draft comparison second, and template exploration third. Domain status sits below the published card. A missing publication has its own first-use state, rather than showing a default design as already live.

## User flow

1. Open `/customer-portal`. The page loads the workspace library and domain status independently. A domain lookup failure does not prevent theme editing.
2. Choose **Add theme** or **Browse templates**. The six templates have distinct editable layouts. Their preview uses the same business name as the saved draft.
3. Preview the website and customer-account pages at desktop or mobile width. Account pages contain sample data. Messaging, invoice downloads, and session actions stay inactive in preview.
4. Customize a saved theme in `/customer-portal/themes/[themeId]`. The editor supports page/section/element settings, device preview, and undo/redo. Save stores a draft; leaving with unsaved changes prompts the user.
5. Publish from the library or editor after reviewing the confirmation. The published card always previews the stored published snapshot, including when the live theme has newer draft changes.
6. Use the theme menu to rename, duplicate, or remove a draft. The current live theme cannot be removed. At least one theme must remain. The library supports 20 themes and explains how to free space.
7. To discard saved changes to the live theme, use **Restore published version**. This replaces its draft with the current published snapshot. Duplicate the draft first to preserve those changes. This is not historical release rollback.

## Data and request boundaries

`PortalThemeLibrary` and `PortalBuilder` call authenticated Next.js Server Actions. Each action checks current admin membership, validates the payload with Zod, and binds the authenticated workspace with `withWorkspaceViewer` before invoking `lib/data/portal-design.ts`.

`workspace_portal_designs` stores one row per workspace:

| Field | Purpose |
| --- | --- |
| `themes` | Up to 20 named, independently editable designs |
| `live_theme_id` | Identifies the theme associated with the current published snapshot |
| `published`, `published_at` | Customer-facing snapshot and its publication time |
| `draft` | Compatibility draft for older readers; replaced when its theme is removed |
| `revision` | Library-wide optimistic concurrency token |
| `updated_by`, `updated_at` | Last successful writer and update time |

Every mutation reads the current revision and then performs an atomic update constrained by that revision. Concurrent changes cannot overwrite a newer library. A failed write leaves the editable draft intact; the library offers refresh for conflicts. An initial insert collision is also reported as a conflict. Theme rows and published content are loaded without a shared response cache, and successful actions revalidate the portal routes.

The database restricts reads to the scoped server role and writes to active workspace admins. Browser `anon` and `authenticated` roles have no direct table grants. Public websites receive only `publicWebsiteDesign` output from the published snapshot. Private customer accounts keep their existing signed-link/session and workspace authorization checks. See [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security) for the underlying database access model.

This update uses the existing builder and theme-library migrations; it requires no new database columns. Install `20261116085836_customer_portal_builder.sql` and `20261116093245_portal_theme_library.sql` before using the feature on another installation.

## Domains and deployment

Theme publishing and domain connection are separate operations. Existing signed invoice links continue to use the default design until a custom design is published. A public business website on a custom domain requires the hosting configuration, DNS ownership checks, and HTTPS verification described in [customer portal domains](customer-portal-domains.md).

The local installation currently has no custom domain and no portal domain-management hosting credentials. The UI reports that setup state. It must not imply that publishing a theme provisions a domain or makes an unverified domain live.

## Verification

The portal tests exercise independent drafts, publishing isolation, rename/removal/restore guards, concurrent revisions, admin authorization, workspace binding, templates, device/page navigation, retry after failure, and read-only access. The rollback-only database check in `tests/portal-design-database.sql` verifies real workspace isolation and write policies without retaining fixtures. Supabase security advisors reported no portal-related findings.

On November 26, 2026, all 2,867 repository tests passed. The affected portal, domain, action, and translation tests were also rerun after the loading optimization. Lint, TypeScript, and production compilation passed. Preview and management dialogs load on demand, and domain-status display is separated from DNS validation to reduce the initial JavaScript download.

The JavaScript size gate remains open: the measured library entry is approximately 195 KB gzip against its 190 KB budget. The project-wide audit also flags the products, workflows, email, and documents entries and several route shells. No budgets were increased. A passing production build does not mean this performance gate passed.

Run `npm run lint`, `npm run test`, TypeScript, the production build, and `npm run perf:bundles` for release checks. Build verification can use `FILAZOO_STABLE_RUNTIME=1` to keep `.next-crm` separate from an active development server.

Before release, complete browser checks at narrow and wide widths, keyboard dialog/menu focus, template-to-editor navigation, and a real authorized publishing cycle. The computer/browser bridge was unavailable during this implementation, so the automated DOM tests and production build do not substitute for that visual review. A real custom-domain test additionally requires a user-owned domain, DNS access, and configured hosting credentials.

The older HTTP smoke script, `scripts/verify-customer-portal.mjs`, could not seed its standalone invoice fixtures because the current database requires invoices to be generated from purchase orders. It retained no test invoices. Its session/message/PDF exercise therefore remains unverified by that script; it needs an order-based fixture before reuse.
