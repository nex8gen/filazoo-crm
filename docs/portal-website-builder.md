# Portal website designer

Workspace administrators open **Customer portal → Edit theme** directly into the VvvebJs website designer. Choose another page from the page selector or add a content page. **Preview portal** switches to the complete customer portal with its secure widgets; **Edit website** returns to the designer. Workspace readers receive the portal preview without editing access.

Drag blocks from **Blocks → Filazoo sections**, or add individual text, image, heading, link and list elements. Double-click text to edit it; select an element to change its properties and styles. Desktop/mobile previews and undo/redo use the upstream editor. Images currently use HTTPS URLs; PHP uploads, upstream AI integrations, and executable embeds are disabled.

**Save** captures the current canvas and persists the draft; **Publish** captures it and selects the live theme. Switching pages or opening the portal preview first captures the current layout so edits are retained. Capture failures keep the current canvas open. Browser navigation protects unsaved edits. **Editor settings** opens page, branding and permission controls, including layout reset and discard. Existing invoice, order-tracking, messaging and language permissions continue to apply independently of presentation.

## Implementation

- `public/vendor/vvveb`: pinned VvvebJs assets, Apache-2.0 license, dependency credits, and the Filazoo adapter. This is the standalone editor used by Vvveb CMS, not an installation of the AGPL PHP CMS or its ecommerce backend.
- `scripts/vendor-vvveb.mjs`: reproducible asset import from commit `1acbab7ebfe3e7b004f1f18c039d26550fc04bd8`. Filazoo adapter files remain separate from upstream source.
- `components/portal-vvveb-editor.tsx`: embedded primary canvas with an origin/source-checked message bridge and correlated capture requests. Vendor assets load in the design view. Brand changes update the canvas without restarting the editor session.
- `lib/portal-website.ts`: presentation-only HTML sanitizer, CSS checks, size-compatible data and restrictive CSP documents. Both the editing canvas and published layout disable scripts. Layout CSS remains inside an iframe.
- `lib/portal-design.ts`: optional `sections[].website` containing HTML/CSS. Existing themes parse unchanged. The existing authorized, revision-checked theme persistence and workspace RLS handle layouts without a migration.

Layouts appear above the existing secure widgets. Content pages display the layout instead of their plain-text body. Sites use the existing portal routes and custom-domain system. This integration does not introduce anonymous public storefronts, carts, checkout, shipping, or independent merchant payment accounts.

## Verification

`tests/portal-website.test.ts` covers active-content removal, CSS restrictions, sandbox documents, size limits and old-theme compatibility. `tests/vvveb-runtime.test.ts` loads the vendored editor in a DOM environment, initializes an existing layout, exercises element settings, inserts a block, checks undo/redo, and captures HTML/CSS. Theme and portal UI tests cover draft/publish separation and existing portal features. A real browser visual check is still required when browser access is available.
