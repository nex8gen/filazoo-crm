import type { AppLanguage } from "./app-language.ts";
import { localizedSource } from "./localized-source.ts";

export type UiTranslator = (value: string, language: AppLanguage) => string;
const attributes = ["aria-label", "aria-description", "aria-valuetext", "placeholder", "data-placeholder", "title", "alt"];
const excluded = "script, style, code, pre, [data-no-translate], [translate='no']";
const editable = "[contenteditable]";

// Keep each node's source, including nodes detached by cached routes or portals.
// Never replace text nodes: React still owns their identity and event handlers.
export function createUiLocalizer(translate: UiTranslator) {
  const texts = new WeakMap<Node, { source: string; translated: string }>();
  const labels = new WeakMap<Element, Map<string, { source: string; translated: string }>>();

  function localize(root: Node, language: AppLanguage) {
    if (root.nodeType === 3) {
      const node = root as Text;
      if (!node.parentElement || node.parentElement.closest(`${excluded}, ${editable}`)) return;
      const previous = texts.get(node);
      const source = localizedSource(node.data, previous?.source, previous?.translated);
      const translated = translate(source, language);
      texts.set(node, { source, translated });
      if (node.data !== translated) node.data = translated;
      return;
    }
    if (root.nodeType !== 1) return;
    const element = root as Element;
    if (element.closest(excluded) || element.parentElement?.closest(editable)) return;
    let sources = labels.get(element);
    if (!sources) { sources = new Map(); labels.set(element, sources); }
    for (const attribute of attributes) {
      const current = element.getAttribute(attribute);
      if (current === null) { sources.delete(attribute); continue; }
      const previous = sources.get(attribute);
      const source = localizedSource(current, previous?.source, previous?.translated);
      const translated = translate(source, language);
      sources.set(attribute, { source, translated });
      if (current !== translated) element.setAttribute(attribute, translated);
    }
    // Localize the editor's labels and empty placeholder, never its saved body,
    // including when the editor is disabled with contenteditable="false".
    if (!element.matches(editable)) for (const child of element.childNodes) localize(child, language);
  }

  function observe(document: Document, language: AppLanguage) {
    localize(document.body, language);
    if (document.querySelector("title")) localize(document.querySelector("title")!, language);
    const observer = new document.defaultView!.MutationObserver(mutations => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData" || mutation.type === "attributes") localize(mutation.target, language);
        for (const node of mutation.addedNodes) localize(node, language);
      }
    });
    // English also needs observation: cached pages and menus can be reattached
    // with Chinese text after the initial language-switch restoration pass.
    observer.observe(document.body, { childList: true, characterData: true, attributes: true, attributeFilter: attributes, subtree: true });
    observer.observe(document.head, { childList: true, characterData: true, subtree: true });
    return () => observer.disconnect();
  }

  return { localize, observe };
}
