import { citationParts, citationUrl, type CitationSource } from "./source-citations.ts";
import { answerStyleInstruction } from "./answer-style.ts";

export function assistantHref(value: string): string | undefined {
  if (!value || /[\u0000-\u0020\\]/.test(value)) return undefined;
  if (/^#filazoo-source-(?:W\d+|A\d+|P|C)$/.test(value)) return value;
  if (/^\/(?:$|(?:companies|products|purchase-orders|company-quotations|invoices|tasks|email|segments|analytics|documents|settings|workflow|messenger|replies)(?:[/?#]|$))/.test(value) && !value.startsWith("//")) return value;
  return citationUrl(value);
}

export function responseMarkdown(text: string, sources: CitationSource[] = []) {
  // Older saved answers used bold references followed by an unlinked app path.
  const linked = text.replace(/(\*\*[^*\n]{1,120}\*\*|#\d+)\s+\((\/(?:invoices|purchase-orders|companies|company-quotations)\/[a-f\d-]{36})\)/gi, (_all, title: string, href: string) => `[${title.replace(/\*\*/g, "")}](${href})`);
  return citationParts(linked, sources).map(part => part.source ? `[${part.source.id}](#filazoo-source-${part.source.id})` : part.text).join("");
}

export const richResponseInstruction = `${answerStyleInstruction}\nRESPONSE PRESENTATION: Use readable Markdown: short paragraphs, compact lists, and tables when they make a requested comparison easier to read. Link saved CRM references as [label](/invoices/verified-id), [label](/purchase-orders/verified-id) or their actual app route. Never print raw HTML, UI JSON or fake download links. After CRM lookups the app automatically adds verified record cards, table/chart views and CSV export; answer the question without repeating those records or claiming these snapshots are exhaustive. Read the relevant records when a CRM analysis or chart is requested; never invent chart data, dates or amounts. Separate currencies and keep explanations distinct from actual execution results.`;
