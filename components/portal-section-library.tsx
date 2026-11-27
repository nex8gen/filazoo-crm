"use client";

import { useState } from "react";
import { ImageIcon, LayoutGrid, Plus, Search, Type } from "lucide-react";
import { Input } from "@/components/ui/input";
import { websiteSectionTypes } from "@/lib/portal-website-design";
import { websiteElementTypes } from "@/lib/portal-website-blocks";

const sectionDescriptions: Record<string, string> = {
  hero: "Large headline, description and a call to action.", text: "Headings, paragraphs and buttons.", image: "Image and editable content side by side.",
  links: "Cards linking to your website pages.", contact: "Contact information and customer account links.", columns: "Flexible columns with nested cards and content.",
  gallery: "A responsive grid of editable images.", faq: "Expandable questions and answers.", testimonials: "Customer quotes, names, photos and optional ratings.",
  statistics: "Numbers and their supporting labels.", banner: "A focused call to action.", slideshow: "Multiple slides with images, text and buttons.",
  logos: "A row of company or partner logos.", products: "Curated product cards with images and links.", video: "A video file with supporting text.", spacer: "Adjustable space between sections.",
};
export function PortalSectionLibrary({ mode, disabled, depth = 0, compact = false, onAdd }: { mode: "section" | "element"; disabled: boolean; depth?: number; compact?: boolean; onAdd: (type: string) => void }) {
  const [search, setSearch] = useState("");
  const options = (mode === "section" ? websiteSectionTypes : websiteElementTypes).filter(item => (depth < 2 || !["group", "card", "slide"].includes(item.value)) && `${item.label} ${mode === "section" ? sectionDescriptions[item.value] : ""}`.toLowerCase().includes(search.toLowerCase()));
  return <div className={`pb-section-library ${compact ? "is-compact" : ""}`}><div className="pb-library-search"><Search /><Input aria-label={`Search ${mode === "section" ? "sections" : "elements"}`} placeholder={`Search ${mode === "section" ? "sections" : "elements"}…`} value={search} onChange={event => setSearch(event.target.value)} /></div>{!compact && <p className="pb-help">{mode === "section" ? "Start with a section, then edit or add the elements inside it." : "Add an element to the selected section or container."}</p>}<div className="pb-library-options">{options.map(item => {
    const Icon = ["hero", "image", "gallery", "logos"].includes(item.value) ? ImageIcon : ["heading", "text", "faq"].includes(item.value) ? Type : LayoutGrid;
    return <button key={item.value} type="button" disabled={disabled} aria-label={`Add ${item.label}`} title={compact ? sectionDescriptions[item.value] : undefined} onClick={() => onAdd(item.value)}><span className="pb-library-icon"><Icon /></span><span><strong>{item.label}</strong>{mode === "section" && !compact && <small>{sectionDescriptions[item.value]}</small>}</span>{!compact && <Plus />}</button>;
  })}</div>{options.length === 0 && <p className="pb-help">No matching {mode === "section" ? "sections" : "elements"}.</p>}</div>;
}
