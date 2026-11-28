<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## AI customer access

- Every non-admin user (operator, BD manager, or viewer) may give the AI access only to customers currently assigned to that user's ID and those customers' conversations. Unassigned customers and other users' customers are excluded.
- Administrators may give the AI access to all customers and accessible customer conversations within their current workspace, including correspondence across staff mailboxes. Workspace boundaries and AI data settings still apply.
- Enforce this in server-side readers, customer chat, AI context, searches, exports and previews. Prompts and hidden UI controls are not authorization checks.
- Recheck assignments before reusing conversation data. Bind caches to workspace/user/role and invalidate saved-chat access when assignments change. Fail closed when conversation ownership cannot be verified.

## AI credit display

- Display AI credit amounts without decimal places everywhere: profile, billing, sidebar, activity totals, tooltips, and accessible labels. Use the shared `formatCredits` helper in `lib/billing/credits.ts`.
- Round displayed amounts down to whole credits with thousands separators. Show a positive amount below one credit as `<1`, and zero as `0`.
- Preserve full precision in accounting, stored usage, API values, calculations, and heatmap intensity. This rule applies to presentation only.
