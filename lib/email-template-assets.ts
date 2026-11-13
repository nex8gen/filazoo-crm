/** Original assets pinned to the same revision as the imported Colorlib HTML. */
const revision = "3018557fe943fb1c3e3367aa52d39b2fca44f725";
const sourceIds = new Set([2, 3, 6, 7, 8, 9, 14, 18, 20, 21, 22, 24, 25, 26, 27, 28]);
export function isEmailTemplateImage(src: string) {
  const match = /^\/email-template-assets\/colorlib\/(\d{1,2})\/images\/([a-zA-Z0-9_.-]+\.(?:jpe?g|png|gif|webp))$/.exec(src);
  return !!match && sourceIds.has(Number(match[1])) && !match[2].includes("..");
}
/** Sent HTML needs a public URL; previews use the bundled, byte-identical file. */
export function publicEmailTemplateImage(src: string) {
  return isEmailTemplateImage(src) ? "https://raw.githubusercontent.com/ColorlibHQ/email-templates/" + revision + src.slice("/email-template-assets/colorlib".length) : "";
}
