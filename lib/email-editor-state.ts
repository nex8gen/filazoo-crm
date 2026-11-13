import { emailDesignSchema, newEmailBlock, newEmailDesign, renderEmailBlockContent, type EmailDesign } from "./email-design.ts";

export type EmailEditorHistory = { past: EmailDesign[]; present: EmailDesign; future: EmailDesign[] };
export type EmailEditorAction = { type: "change"; design: EmailDesign } | { type: "undo" } | { type: "redo" };
export function emailEditorHistory(state: EmailEditorHistory, action: EmailEditorAction): EmailEditorHistory {
  if (action.type === "undo") { const previous = state.past.at(-1); return previous ? { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] } : state; }
  if (action.type === "redo") { const next = state.future[0]; return next ? { past: [...state.past, state.present], present: next, future: state.future.slice(1) } : state; }
  if (JSON.stringify(action.design) === JSON.stringify(state.present)) return state;
  return { past: [...state.past.slice(-39), state.present], present: action.design, future: [] };
}

export const emailPrebuiltLayouts = ["welcome", "products", "newsletter"] as const;
export type EmailPrebuiltLayout = typeof emailPrebuiltLayouts[number];
export function createEmailPrebuilt(kind: EmailPrebuiltLayout, theme?: EmailDesign["theme"]): EmailDesign {
  const base = newEmailDesign();
  if (theme) base.theme = { ...theme };
  if (kind === "welcome") base.blocks.push(newEmailBlock("text", { text: "Hello {{first_name}},\n\nWelcome to Filazoo.", fontSize: 18 }), newEmailBlock("button"));
  if (kind === "products") {
    const columns = newEmailBlock("columns");
    base.blocks.push(newEmailBlock("text", { text: "Explore our products", fontSize: 26, bold: true, align: "center" }), columns, newEmailBlock("product", { parentId: columns.id, column: 0 }), newEmailBlock("product", { parentId: columns.id, column: 1 }));
  }
  if (kind === "newsletter") base.blocks.push(newEmailBlock("text", { text: "Your latest update", fontSize: 28, bold: true }), newEmailBlock("text", { text: "Hello {{first_name}},\n\nShare your latest news here." }), newEmailBlock("divider"), newEmailBlock("text", { text: "Filazoo", fontSize: 12, align: "center" }));
  if (theme) base.blocks = base.blocks.map(block => ({ ...block, fontFamily: theme.fontFamily, ...(block.fontSize === 16 ? { fontSize: theme.fontSize } : {}), ...(block.color === "#202020" ? { color: theme.textColor } : block.type === "header" ? { color: theme.accent } : {}), ...(block.type === "button" ? { background: theme.accent } : {}) }));
  return emailDesignSchema.parse(base);
}

export function resizeEmailColumns(design: EmailDesign, id: string, count: number): EmailDesign {
  if (count !== 2 && count !== 3) return design;
  const block = design.blocks.find(item => item.id === id);
  if (block?.type !== "columns") return design;
  return { ...design, blocks: design.blocks.map(item => item.id === id ? { ...item, columnCount: count, presentation: { ...item.presentation, ...(item.presentation?.columns?.widths ? { columns: { ...item.presentation.columns, widths: Array.from({ length: count }, () => 100 / count) } } : {}) } } : item.parentId === id && item.column >= count ? { ...item, column: count - 1 } : item) };
}

export function emailEditorCanSave(design: EmailDesign) {
  return design.blocks.some(block => {
    const rendered = renderEmailBlockContent(block);
    if (block.type === "html") return Boolean(rendered.replace(/<[^>]*>/g, "").trim() || /<img\b[^>]*\bsrc\s*=/i.test(rendered));
    return ["text", "header", "button", "coupon", "quote", "product", "video", "social"].includes(block.type) && Boolean(block.text.trim() || block.heading.trim() || block.src || block.href || block.links.some(link => link.kind !== "spacer" && link.label.trim() && link.href)) || block.type === "image" && Boolean(block.src && rendered) || block.type === "table" && block.rows.some(row => row.some(cell => cell.trim()));
  });
}
