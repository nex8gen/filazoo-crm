# Original email template collection

The Email library ships 16 Colorlib designs adapted to the native drag-and-drop email editor. The original source HTML and artwork remain bundled unchanged for provenance. The editable versions retain source copy, images, colors and layout structure, using the editor's supported fonts and responsive blocks.

- Upstream: https://github.com/ColorlibHQ/email-templates
- Pinned revision: `3018557fe943fb1c3e3367aa52d39b2fca44f725`
- Selected source folders: 2, 3, 6, 7, 8, 9, 14, 18, 20, 21, 22, 24, 25, 26, 27, 28.
- License: [upstream MIT notice](licenses/colorlib-email-templates-MIT.txt), also distributed with the public template files.
- Original files: `public/email-template-assets/colorlib/<source folder>/`.
- Provenance: `public/email-template-assets/colorlib/sources.json` records the byte size and SHA-256 of every unchanged upstream HTML/image file.

`lib/colorlib-email-templates.json` contains the source HTML with relative image references resolved to the bundled files. `lib/colorlib-email-designs.json` contains native text, image, button, header, section, column, divider and table blocks. There are no HTML blocks in these library designs. Gallery thumbnails use generated `editor.html` files rendered from the same native designs used by the editor, previews and export. Original `index.html` files remain unchanged.

Templates are copied into Custom emails for editing. Text, images, links and layout can be edited and rearranged independently, saved and reopened with undo/redo support. Photo heroes use editable section background images. Receipt and agenda content uses native tables. The six older Filazoo text-template IDs remain resolvable for existing references but are no longer listed in the shared catalog. Existing saved HTML copies are preserved; newly customized catalog copies use native blocks.

Rebuild the native catalog and its previews with `node --experimental-strip-types scripts/convert-email-library.mjs`. Conversion uses the pinned local source files without network access. Generated IDs are deterministic. The editor accepts up to 200 blocks, leaving room to customize the longer designs; the existing nesting and total-size limits still apply.

Preview images load from the CRM's static assets. Sent/exported HTML resolves image paths to the same pinned upstream public image files, including section background images. This avoids localhost or authenticated asset URLs in recipients' mail. Original custom fonts use supported email-safe fallbacks, inline formatting is adapted to block styling, and complex source markup uses the editor's standard layout and table rendering. These are editable adaptations rather than pixel-identical HTML reproductions. Rendering varies by email client.

Template copy, demo destinations and unsubscribe/preferences links remain as supplied by Colorlib. Public inline links remain available as editable link blocks. Workspace users must customize these for their own campaigns before sending; buttons with demo `#` destinations are blocked by the existing campaign link validation until a valid destination is entered.
