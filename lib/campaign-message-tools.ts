import { parseDocument } from "htmlparser2";
import type { EmailDesign } from "./email-design.ts";
import type { CampaignConfig, CampaignRecipient } from "./email-campaigns.ts";

export const subjectVariationKinds = ["Personalization vs no personalization", "Short vs long", "Question vs statement", "Emoji vs no emoji"] as const;
export type SubjectVariationKind = typeof subjectVariationKinds[number];

export function suggestCampaignSubject(subject: string, kind: SubjectVariationKind): string {
  const value = subject.trim();
  if (!value) return "";
  if (kind === "Personalization vs no personalization") {
    return (/\{\{\s*(first_name|name)\s*\}\}/.test(value) ? value.replace(/\{\{\s*(first_name|name)\s*\}\}[,\s]*/g, "") : `{{first_name}}, ${value}`).slice(0, 300);
  }
  if (kind === "Short vs long") {
    const words = value.split(/\s+/);
    return (words.length > 6 ? words.slice(0, Math.ceil(words.length / 2)).join(" ") : `${value.replace(/[.!?]+$/, "")} — Find out more`).slice(0, 300);
  }
  if (kind === "Question vs statement") return value.endsWith("?") ? value.slice(0, -1) : `${value.replace(/[.!]+$/, "").slice(0, 299)}?`;
  const withoutEmoji = value.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, "").trim();
  return withoutEmoji !== value ? withoutEmoji : `✨ ${value}`.slice(0, 300);
}

/** Stable, balanced assignment independent of query order; one variant per recipient. */
export function assignCampaignSubjects(config: CampaignConfig, recipients: CampaignRecipient[], campaignId: string) {
  function hash(id: string) { let value = 2166136261; for (const char of `${campaignId}:${id}`) value = Math.imul(value ^ char.charCodeAt(0), 16777619); return value >>> 0; }
  const ordered = config.subjectTest ? [...recipients].sort((a, b) => hash(a.id) - hash(b.id) || a.id.localeCompare(b.id)) : recipients;
  return ordered.map((recipient, index) => ({ recipient, variant: config.subjectTest ? (index % 2 === 0 ? "A" : "B") as "A" | "B" : undefined, subject: config.subjectTest && index % 2 ? config.subjectTest.subjectB : config.subject }));
}

/** Recognize a preheader authored inside an imported HTML template. */
export function embeddedCampaignPreheader(design?: EmailDesign): string {
  type Node = ReturnType<typeof parseDocument>["children"][number];
  function text(node: Node): string { return node.type === "text" ? node.data : "children" in node ? node.children.map(text).join("") : ""; }
  function find(nodes: Node[]): string {
    for (const node of nodes) {
      if (!("attribs" in node) || !("children" in node)) continue;
      if (/preheader|preview[-_]?text/i.test(`${node.attribs.class ?? ""} ${node.attribs.id ?? ""}`) || /display\s*:\s*none/i.test(node.attribs.style ?? "")) {
        const value = text(node).replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
        if (value) return value.slice(0, 300);
      }
      const nested = find(node.children); if (nested) return nested;
    }
    return "";
  }
  for (const block of design?.blocks ?? []) if (block.type === "html") { const value = find(parseDocument(block.html).children); if (value) return value; }
  return "";
}
