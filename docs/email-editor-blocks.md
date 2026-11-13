# Visual email editor controls

The inspector follows the supplied reference: separate settings sections, compact bordered inputs, segmented alignment, color swatches, expandable borders/backgrounds, and Styles/Display tabs. Split blocks also have a Content tab. Editor chrome uses the bundled Inter font with 14px controls and 16px section headings; email body text defaults to 16px and retains its selected font. Existing Base UI/shadcn primitives handle popups, dialogs and keyboard focus. The palette uses two-column cards with a decorative miniature preview above each block name, with Basic/Pre-built tabs and separate Blocks/Layout groups. The preview illustrates the block type; the full card remains the click and drag target.

The palette, inspector, canvas and layers share the same block names. Split/Columns and Drop shadow/Section retain their inserted identity after editing and saving. The inspector groups button text and typography together and places header logo controls under Desktop layout. Block settings, social settings and template style groups use keyboard-accessible plus/minus disclosure controls. Editing values preserves each section's open/closed state; selecting another block initializes that block's controls independently. Block actions are in the header menu.

Number inputs retain their typing draft until blur, clamp committed values to the supported range, and keep units and steppers in fixed positions. Letter spacing supports negative values and 0.1px increments. Switching four-sided padding to paired controls explicitly matches bottom to top and right to left; undo restores the original sides and exposes unequal values.

| Block | Editable features |
| --- | --- |
| Text | Inline text and sidebar editing; font, size, color, bold, italic, underline, strikethrough, letter spacing, line height, alignment; independent text-area padding/background/border and outer block padding/background. |
| Image | Select or drop PNG/JPG/GIF/WebP; create a PNG banner; URL, alt text, link; automatic/fixed width, fixed height or locked aspect ratio, alignment, separate desktop/mobile fill; image-area padding/background/border, corner radius and outer spacing. |
| Split / Columns | Select a column; choose text, image or sanitized HTML content; edit/upload within the selected column; two or three columns, linked percentage widths totaling 100%, gap; left-to-right, right-to-left or no mobile stacking. Additional nested blocks remain supported. |
| Button | Text and public destination; typography and letter spacing; fit-to-text/full-width, alignment, inner padding, fill, radius, border and shadow; independent block background/padding and mobile width. |
| Header bar | Logo upload/URL, alt text and destination; text links or linked images; stacked/left/right desktop arrangement, mobile stacking/inline/logo-only/links-only, separate mobile logo; navigation typography, vertical/horizontal alignment and link padding. |
| Drop shadow / Section | Editable nested content; shadow strength/color, background color/image, minimum height, corner radius and padding. |
| Divider | Solid/dashed/dotted/double line, thickness, color, background, outer padding and mobile width. |
| Spacer | Height, background and device visibility. |
| Social links | Platform/custom icons, destination and optional text labels; add/remove icons or spacers; drag, keyboard and button ordering; label typography; icon size/color, gap, alignment, mobile stacking, background and two-axis/four-side padding. |
| Product | Static catalog picker (search, pagination, up to nine products, reorder/remove) or saved catalog-feed rules; editable product snapshots and URLs; name/price/original price/description/verified rating/button visibility; grid or image beside text, rows/columns/start item, image height, padding, border and mobile stacking; independent name, price and button typography/styling. |
| Coupon, table, quote, video and HTML | Existing content-specific editing, typography where relevant, appearance, spacing and device visibility. HTML is sanitized. Video uses a linked thumbnail for email compatibility. |

All blocks support desktop/mobile visibility. Hidden content remains selectable as an editor placeholder. Changes participate in undo/redo, template saves and campaign reload recovery. Canvas, preview, HTML export and queued email use shared configuration and rendering.

## Images and actual delivery

Static source uploads up to 10 MB are optimized in the browser when larger than the 750 KB inline limit. Small images keep their original bytes. GIFs up to 750 KB retain animation; larger GIFs are rejected with an explanation. The banner maker draws a real PNG from the entered text/colors and does not claim AI generation.

Private product images remain authenticated URLs during editing. At campaign queue time the server checks image ownership, downloads from the existing private storage bucket, bounds static catalog images to 600px, and embeds them through the existing CID MIME path. Repeated images are deduplicated. HTML export embeds private images using the signed-in user's authenticated download. Image dimensions and alignment survive MIME preparation.

Rendered email previews permit the frame's same origin for authenticated product images while scripts, forms and top-level navigation remain sandboxed. The [HTML iframe sandbox specification](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox) defines those separate permissions. Raw HTML content is sanitized before previewing.

## Catalog behavior and limits

Dynamic feeds use the actual CRM catalog: material, name/SKU search, stock filter and name/date/price ordering. The server refreshes matching products once when the campaign is queued; every recipient receives that snapshot. Scheduled campaigns retain the snapshot from queue time. These are catalog rules, not personalized recommendation feeds.

Product buttons and linked names require a public product URL before sending. Feed URLs use an explicitly entered template with `{sku}`; store URLs are never guessed. Original prices and verified ratings are shown only when supplied. Automatic recipient localization and an external reviews feed require catalog/recipient data and integrations that this CRM does not currently provide; the inspector does not present them as working switches.

Custom fonts fall back to email-safe fonts when unavailable. Responsive rules, rounded corners and shadows depend on the receiving email client. This implementation is locally tested through HTML and MIME generation; it does not certify identical rendering in every mail app or send live verification campaigns.
