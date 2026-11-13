import type { LibraryDocument } from "./documents.ts";
import { emailDesignText, newEmailBlock, newEmailDesign } from "./email-design.ts";
import { visualEmailTemplates } from "./visual-email-templates.ts";

// Stable IDs belong to the shipped catalog, never to a workspace database row.
const definitions = [
  { name: "Customer introduction", subject: "An introduction for {{company}}", heading: "Let's work together", text: "Hello {{first_name}},\n\nI'd like to introduce our team and learn more about your business. We can help you explore products and options that fit your needs.\n\nWhat are you working on, and how can we help?\n\nBest regards,\nYour team" },
  { name: "Product introduction", subject: "Discover products for {{company}}", heading: "Find your next product", text: "Hello {{first_name}},\n\nWe'd love to share our product range with you. Tell us the specifications, quantities, and delivery timeline you have in mind, and we'll recommend suitable options.\n\nReply to request a catalog or more product details.\n\nBest regards,\nYour team" },
  { name: "Quotation follow-up", subject: "Following up on your quotation", heading: "Any questions about your quote?", text: "Hello {{first_name}},\n\nI'm following up on the quotation we shared. Have you had a chance to review it?\n\nPlease let us know if you have questions about pricing, specifications, or delivery. We'd be happy to help you with the next steps.\n\nBest regards,\nYour team" },
  { name: "Sample follow-up", subject: "How did your samples work out?", heading: "We'd love your feedback", text: "Hello {{first_name}},\n\nI wanted to check whether you've had a chance to evaluate the samples. We'd love to hear your feedback and answer any questions.\n\nIf you need a different specification or more information, just reply to this email.\n\nBest regards,\nYour team" },
  { name: "Order thank you", subject: "Thank you for your order", heading: "Thank you for choosing us", text: "Hello {{first_name}},\n\nThank you for placing your order with us. We appreciate the opportunity to work with {{company}}.\n\nOur team will keep you updated on the next steps. If you have any questions or additional requirements, please get in touch.\n\nBest regards,\nYour team" },
  { name: "Customer check-in", subject: "Checking in with {{company}}", heading: "How can we help?", text: "Hello {{first_name}},\n\nIt's been a while since we last connected. How are things going at {{company}}?\n\nIf you have upcoming projects or purchasing plans, we'd be happy to discuss how we can support you.\n\nBest regards,\nYour team" },
];

const templates: LibraryDocument[] = definitions.map((definition, index) => {
  const suffix = String(index + 1).padStart(12, "0");
  const design = newEmailDesign();
  design.blocks = [
    newEmailBlock("text", { id: `f11a2000-0001-4000-8000-${suffix}`, text: definition.heading, fontSize: 28, bold: true, color: "#0b494c", padding: 28 }),
    newEmailBlock("text", { id: `f11a2000-0002-4000-8000-${suffix}`, text: definition.text, padding: 28 }),
  ];
  return {
    id: `f11a2000-0000-4000-8000-${suffix}`, name: definition.name, kind: "template", origin: "builtin", category: "promotion",
    mime_type: "text/plain", size: 0, folder_id: null, company: "Filazoo", tags: [], description: "A prebuilt Filazoo template available to every workspace. Customize a copy to save your own version.",
    subject: definition.subject, body: emailDesignText(design), email_design: design, design_version: "1", related_ids: [], starred: false,
    created_at: "2026-11-13T00:00:00Z", updated_at: "2026-11-13T00:00:00Z", deleted_at: null,
  };
});

templates.push(...visualEmailTemplates());

/** Return copies so customization cannot alter the permanent catalog. */
export function builtinEmailTemplates(): LibraryDocument[] {
  return structuredClone(templates.filter(item => item.preview_url).map(item => ({ ...item, email_design: undefined })));
}
export function builtinEmailTemplate(id: string): LibraryDocument | undefined {
  const template = templates.find(item => item.id === id);
  return template ? structuredClone(template) : undefined;
}
