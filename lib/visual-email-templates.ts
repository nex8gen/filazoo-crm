import sources from "./colorlib-email-templates.json" with { type: "json" };
import converted from "./colorlib-email-designs.json" with { type: "json" };
import type { LibraryDocument } from "./documents.ts";
import { emailDesignSchema, emailDesignText } from "./email-design.ts";

export const visualEmailTemplateSources = sources.map(source => ({ id: source.id, name: source.name, source: source.source, license: "MIT" }));

/** Colorlib designs adapted to native, independently editable email blocks. */
export function visualEmailTemplates(): LibraryDocument[] {
  return sources.map(source => {
    const native = converted.find(item => item.id === source.id);
    if (!native) throw new Error(`Missing editable email template: ${source.name}`);
    const design = emailDesignSchema.parse(native.design);
    return { id: source.id, name: source.name, kind: "template", origin: "builtin", category: "promotion", mime_type: "text/plain", size: 0, folder_id: null, company: "Colorlib", tags: ["Drag and drop", "Editable design"], description: "Colorlib design adapted for the drag-and-drop editor. Customize text, images, buttons and layout in your own copy.", subject: source.name, body: emailDesignText(design), email_design: design, design_version: "2", preview_url: native.preview, related_ids: [], starred: false, created_at: "2026-11-13T01:00:00Z", updated_at: "2026-11-13T02:00:00Z", deleted_at: null };
  });
}
