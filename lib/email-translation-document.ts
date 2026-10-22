/** Prepare text-only replacements; translation never gets to rewrite email markup. */
export function prepareEmailTranslation(body: string, html?: string | null) {
  if (!html) return { segments: [body], apply: (segments: string[]) => ({ body: segments[0], html: null }) };

  const document = new DOMParser().parseFromString(html, "text/html");
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const replacements: Array<{ node: Text; index: number }> = [];
  const segments: string[] = [];
  const indices = new Map<string, number>();
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest("script, style, noscript, template, svg, [hidden], [translate='no'], [data-no-translate]")) continue;
    const text = node.textContent?.trim() ?? "";
    if (!/[A-Za-z]{2}/.test(text)) continue;
    let index = indices.get(text);
    if (index === undefined) {
      index = segments.length;
      indices.set(text, index);
      segments.push(text);
    }
    replacements.push({ node: node as Text, index });
  }

  return {
    segments,
    apply(translated: string[]) {
      if (translated.length !== segments.length || translated.some((text) => typeof text !== "string" || !text.trim())) {
        throw new Error("The translation service returned an incomplete email. Please try again.");
      }
      for (const { node, index } of replacements) {
        // Retain spaces around inline links and emphasis, and insert only text.
        node.textContent = node.textContent!.replace(/\S[\s\S]*\S|\S/, () => translated[index]);
      }
      document.documentElement.lang = "zh-CN";
      return { body, html: `<!doctype html>\n${document.documentElement.outerHTML}` };
    },
  };
}
