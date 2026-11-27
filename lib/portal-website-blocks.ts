import type { PortalWebsiteBlock, PortalWebsiteSection } from "./portal-design.ts";

export const websiteElementTypes = [
  { value: "heading", label: "Heading", category: "Content" }, { value: "text", label: "Text", category: "Content" },
  { value: "image", label: "Image", category: "Media" }, { value: "video", label: "Video", category: "Media" },
  { value: "button", label: "Button", category: "Content" }, { value: "icon", label: "Icon & label", category: "Content" },
  { value: "group", label: "Group", category: "Layout" }, { value: "card", label: "Card", category: "Layout" },
  { value: "slide", label: "Slide", category: "Layout" }, { value: "faq", label: "Question & answer", category: "Content" },
  { value: "testimonial", label: "Customer quote", category: "Content" }, { value: "stat", label: "Statistic", category: "Content" },
  { value: "divider", label: "Divider", category: "Layout" }, { value: "spacer", label: "Spacer", category: "Layout" },
] as const;

export type WebsiteBlockContext = { brandName: string; supportEmail: string; pages: { id: string; title: string; enabled: boolean }[]; pageId: string };
export function blockCanContainChildren(block: PortalWebsiteBlock) { return ["group", "card", "slide", "faq"].includes(block.type); }

export function createWebsiteBlock(type: PortalWebsiteBlock["type"], id: string): PortalWebsiteBlock {
  return { id, type, enabled: true, title: websiteElementTypes.find(item => item.value === type)!.label,
    text: type === "heading" ? "Your heading" : type === "text" ? "Add your text here." : type === "button" ? "Learn more" : "",
    imageUrl: "", alt: "", link: type === "button" ? "account" : "", style: {},
    ...(["group", "card", "slide"].includes(type) ? { children: [] } : {}),
  };
}
function element(type: PortalWebsiteBlock["type"], id: string, patch: Partial<PortalWebsiteBlock> = {}) {
  return { ...createWebsiteBlock(type, id), ...patch };
}
function card(id: string, title: string, link = "", image = false): PortalWebsiteBlock {
  return element("card", id, { title, style: { padding: 24, radius: 8 }, children: [
    ...(image ? [element("image", `${id}-image`, { title: "Product image", style: { imageAspect: "square" } })] : []),
    element("heading", `${id}-heading`, { text: title, style: { fontSize: 22 } }),
    element("text", `${id}-text`, { text: "", title: "Description" }),
    ...(link ? [element("button", `${id}-button`, { text: "Learn more", link, style: { buttonStyle: "text" } })] : []),
  ] });
}

/** Legacy section fields become editable elements on demand, without changing saved themes. */
export function websiteSectionBlocks(section: PortalWebsiteSection, context: WebsiteBlockContext): PortalWebsiteBlock[] {
  if (section.blocks) return resolveWebsiteBlocks(section.blocks, context);
  const heading = element("heading", "heading", { title: "Heading", text: section.title, binding: "title", headingLevel: section.type === "hero" ? "h1" : "h2" });
  const description = element("text", "description", { title: "Description", text: section.body, binding: "body" });
  const action = element("button", "button", { title: "Button", text: section.buttonLabel, link: section.buttonPage, binding: "button" });
  const intro = [heading, description];
  if (section.type === "hero" || section.type === "banner") return [
    element("text", "eyebrow", { title: "Eyebrow", text: `${context.brandName} · Business to business`, binding: "eyebrow", style: { fontSize: 11, fontWeight: "600" } }), ...intro, action,
  ];
  if (section.type === "image") return [element("image", "image", { title: "Image", imageUrl: section.imageUrl, alt: section.title, binding: "image", style: { imageAspect: "landscape" } }), element("group", "copy", { title: "Text & button", children: [...intro, action] })];
  if (section.type === "links") return [...intro, element("group", "page-links", { title: "Page cards", style: { columns: 2, gap: 16 }, children: context.pages.filter(page => page.enabled && page.id !== "home" && page.id !== context.pageId).map((page, index) => {
    const block = card(page.id.length <= 40 ? `page-${page.id}` : `page-${index}-${page.id.slice(0, 32)}`, page.title, `pages/${page.id}`);
    return { ...block, sourcePageId: page.id, children: block.children?.map(child => ({ ...child, ...(child.type === "heading" ? { binding: "page-title" as const, sourcePageId: page.id } : child.type === "button" ? { binding: "page-link" as const, sourcePageId: page.id } : {}) })) };
  }) })];
  if (section.type === "contact") return [...intro,
    element("button", "email", { title: "Email address", text: context.supportEmail, link: context.supportEmail ? `mailto:${context.supportEmail}` : "", binding: "email", style: { buttonStyle: "solid" } }),
    element("button", "account", { title: "Customer account link", text: "Already a customer?", link: "account", style: { buttonStyle: "text" } }),
  ];
  if (section.type === "columns" || section.type === "products") return [...intro, element("group", "cards", { title: section.type === "products" ? "Products" : "Columns", style: { columns: 3, gap: 20 }, children: [1, 2, 3].map(index => card(`card-${index}`, section.type === "products" ? `Product ${index}` : `Column ${index}`, "account", section.type === "products")) })];
  if (section.type === "gallery" || section.type === "logos") return [...intro, element("group", "images", { title: section.type === "logos" ? "Logos" : "Images", style: { columns: section.type === "logos" ? 4 : 3, gap: 20 }, children: [1, 2, 3].map(index => element("image", `image-${index}`, { title: `Image ${index}`, style: { imageAspect: section.type === "logos" ? "landscape" : "square", imageFit: section.type === "logos" ? "contain" : "cover" } })) })];
  if (section.type === "faq") return [...intro, ...[1, 2, 3].map(index => element("faq", `question-${index}`, { title: `Question ${index}`, text: "Add your answer here." }))];
  if (section.type === "testimonials") return [...intro, element("group", "quotes", { title: "Customer quotes", style: { columns: 3, gap: 20 }, children: [1, 2, 3].map(index => element("testimonial", `quote-${index}`, { title: "Customer name", text: "", alt: "", rating: 0, style: { padding: 24, radius: 8 } })) })];
  if (section.type === "statistics") return [...intro, element("group", "statistics", { title: "Statistics", style: { columns: 3, gap: 24 }, children: [1, 2, 3].map(index => element("stat", `stat-${index}`, { title: `Label ${index}`, text: "—" })) })];
  if (section.type === "slideshow") return [1, 2].map(index => element("slide", `slide-${index}`, { title: `Slide ${index}`, children: [element("heading", `slide-${index}-heading`, { text: index === 1 ? section.title : "Your next headline", ...(index === 1 ? { binding: "title" as const } : {}) }), element("text", `slide-${index}-text`, { text: index === 1 ? section.body : "Add a description for this slide.", ...(index === 1 ? { binding: "body" as const } : {}) }), element("button", `slide-${index}-button`, { text: index === 1 ? section.buttonLabel : "Learn more", link: section.buttonPage, ...(index === 1 ? { binding: "button" as const } : {}) })] }));
  if (section.type === "video") return [...intro, element("video", "video", { title: "Video", link: "" })];
  if (section.type === "spacer") return [element("spacer", "spacer", { style: { height: 48 } })];
  return [...intro, action];
}

export function websiteBlockAt(blocks: PortalWebsiteBlock[], path: number[]): PortalWebsiteBlock | undefined {
  let current: PortalWebsiteBlock | undefined;
  let siblings = blocks;
  for (const index of path) { current = siblings[index]; if (!current) return; siblings = current.children ?? []; }
  return current;
}
export function changeWebsiteBlock(blocks: PortalWebsiteBlock[], path: number[], change: (block: PortalWebsiteBlock) => PortalWebsiteBlock | null): PortalWebsiteBlock[] {
  if (!path.length) return blocks;
  return blocks.flatMap((block, index) => {
    if (index !== path[0]) return [block];
    if (path.length > 1) return [{ ...block, children: changeWebsiteBlock(block.children ?? [], path.slice(1), change) }];
    const next = change(block); return next ? [next] : [];
  });
}
export function changeWebsiteSiblings(blocks: PortalWebsiteBlock[], parent: number[], change: (siblings: PortalWebsiteBlock[]) => PortalWebsiteBlock[]): PortalWebsiteBlock[] {
  return parent.length ? changeWebsiteBlock(blocks, parent, block => ({ ...block, children: change(block.children ?? []) })) : change(blocks);
}
export function countWebsiteBlocks(blocks: PortalWebsiteBlock[]): number { return blocks.reduce((total, block) => total + 1 + countWebsiteBlocks(block.children ?? []), 0); }
export function websiteBlockPath(blocks: PortalWebsiteBlock[], id: string, parent: number[] = []): number[] | undefined {
  for (let index = 0; index < blocks.length; index++) {
    const path = [...parent, index];
    if (blocks[index].id === id) return path;
    const nested = websiteBlockPath(blocks[index].children ?? [], id, path); if (nested) return nested;
  }
}
export function duplicateWebsiteBlock(block: PortalWebsiteBlock, preserveBindings = false): PortalWebsiteBlock {
  return { ...block, id: crypto.randomUUID(), ...(!preserveBindings ? { binding: block.binding === "eyebrow" ? "eyebrow" as const : undefined, sourcePageId: undefined, contentOverride: true } : {}), ...(block.children ? { children: block.children.map(child => duplicateWebsiteBlock(child, preserveBindings)) } : {}) };
}
/** Context bindings remain live until the merchant edits that element's content. */
export function resolveWebsiteBlocks(blocks: PortalWebsiteBlock[], context: WebsiteBlockContext): PortalWebsiteBlock[] {
  return blocks.map(block => {
    const page = block.sourcePageId ? context.pages.find(item => item.id === block.sourcePageId) : undefined;
    return { ...block,
      ...(block.sourcePageId && (!page || !page.enabled) ? { enabled: false } : {}),
      ...(!block.contentOverride && block.binding === "eyebrow" ? { text: `${context.brandName} · Business to business` } : {}),
      ...(!block.contentOverride && block.binding === "email" ? { text: context.supportEmail, link: context.supportEmail ? `mailto:${context.supportEmail}` : "" } : {}),
      ...(!block.contentOverride && block.binding === "page-title" && page ? { text: page.title } : {}),
      ...(!block.contentOverride && block.binding === "page-link" && page ? { link: page.id === "home" ? "home" : `pages/${page.id}` } : {}),
      ...(block.children ? { children: resolveWebsiteBlocks(block.children, context) } : {}),
    };
  });
}
export function websiteBinding(blocks: PortalWebsiteBlock[], binding: PortalWebsiteBlock["binding"]): PortalWebsiteBlock | undefined {
  for (const block of blocks) {
    if (block.binding === binding) return block;
    const child = websiteBinding(block.children ?? [], binding); if (child) return child;
  }
}
export function publicWebsiteBlocks(blocks: PortalWebsiteBlock[]): PortalWebsiteBlock[] {
  return blocks.filter(block => block.enabled && !(block.style?.desktopVisible === false && block.style?.mobileVisible === false)).map(block => ({ ...block, children: block.children ? publicWebsiteBlocks(block.children) : undefined }));
}
export function safeWebsiteLink(value: string, basePath = "") {
  if (/^(home|account|pages\/[A-Za-z0-9_-]{1,64})$/.test(value)) return value === "home" ? basePath || "/" : `${basePath}/${value}`;
  if (/^#[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) || /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || /^tel:\+?[0-9 ()-]{3,30}$/.test(value)) return value;
  try { const url = new URL(value); if (url.protocol === "https:" && !url.username && !url.password) return value; } catch {}
  return undefined;
}
