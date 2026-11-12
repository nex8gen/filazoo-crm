"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Check, ChevronDown, Code, FileText, Loader2, Mail, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Type } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useDocumentLibrary } from "@/components/use-document-library";
import { emailDesignText, newEmailDesign, renderEmailDesign, type EmailDesign } from "@/lib/email-design";
import type { LibraryDocument } from "@/lib/documents";
import type { Product as MarketingProduct } from "@/lib/types";

const EmailDesignEditor = dynamic(() => import("./email-design-editor").then(module => module.EmailDesignEditor));

async function fullTemplate(template: LibraryDocument): Promise<LibraryDocument> {
  if (!template.design_version || template.email_design) return template;
  const response = await fetch(`/api/documents/${template.id}?details=1`, { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Unable to open the template.");
  return result.document;
}

function TemplatePaper({ template }: { template: LibraryDocument }) {
  const [design, setDesign] = useState<EmailDesign | null>(template.email_design ?? null);
  useEffect(() => {
    let active = true;
    if (template.design_version && !template.email_design) void fullTemplate(template).then(value => { if (active) setDesign(value.email_design ?? null); }).catch(() => {});
    return () => { active = false; };
  }, [template]);
  return <span className="campaign-builder-templatePaper">{design ? <iframe title={`${template.name} thumbnail`} sandbox="" loading="lazy" tabIndex={-1} srcDoc={renderEmailDesign(design).html} /> : <><Mail /><strong>{template.subject || template.name}</strong><span>{template.body}</span></>}</span>;
}

export function CampaignTemplateLibrary({ selectedId, onSelect, onDesignApply, canWrite, design, body, name, subject, products }: { selectedId: string | null; onSelect: (template: LibraryDocument) => void; onDesignApply: (design: EmailDesign, template?: LibraryDocument | null) => void; canWrite: boolean; design?: EmailDesign; body: string; name: string; subject: string; products: MarketingProduct[] }) {
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ design: EmailDesign; template?: LibraryDocument | null } | null>(null);
  const params = new URLSearchParams({ view: "templates", sort: "newest", q: query });
  const library = useDocumentLibrary(params.toString(), offset, revision);
  const templates = (library.data?.documents.length ?? 0) > 60 ? library.data!.documents.slice(offset, offset + 60) : library.data?.documents ?? [];
  async function open(template: LibraryDocument, edit: boolean) {
    if (!canWrite) return;
    setOpening(template.id);
    try { const complete = await fullTemplate(template); if (edit) setEditor({ design: complete.email_design ?? newEmailDesign(complete.body, "text"), template: complete }); else onSelect(complete); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Unable to open the template."); }
    finally { setOpening(null); }
  }
  async function save(next: EmailDesign, title: string, existing?: LibraryDocument | null) {
    const response = await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(existing ?? {}), action: existing ? "update" : "create", id: existing?.id ?? crypto.randomUUID(), kind: "template", name: title, category: existing?.category ?? "everyday", subject, body: emailDesignText(next), email_design: next }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to save the template.");
    setRevision(value => value + 1); library.invalidate(); toast.success("Email template saved");
    return result.document as LibraryDocument;
  }
  return <div className="campaign-builder-templates"><div className="campaign-builder-templateToolbar"><div className="campaign-builder-templateSearch"><Search /><Input aria-label="Search email templates" placeholder="Search templates" value={query} onChange={event => { setQuery(event.target.value); setOffset(0); }} /></div>{canWrite ? <>{body || design ? <Button variant="outline" size="sm" onClick={() => setEditor({ design: design ?? newEmailDesign(body, "text") })}><Pencil />Edit email</Button> : null}<DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="sm"><Plus />Create<ChevronDown /></Button>} /><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => setEditor({ design: newEmailDesign() })}><Mail />Drag-and-drop email</DropdownMenuItem><DropdownMenuItem onClick={() => setEditor({ design: newEmailDesign("", "html") })}><Code />HTML email</DropdownMenuItem><DropdownMenuItem onClick={() => setEditor({ design: newEmailDesign("", "text") })}><Type />Text email</DropdownMenuItem></DropdownMenuContent></DropdownMenu></> : null}</div>
    {library.error ? <div className="campaign-builder-empty" role="alert"><p>{library.error}</p><Button size="sm" variant="outline" onClick={() => setRevision(value => value + 1)}><RefreshCw />Try again</Button></div> : library.loading ? <div className="campaign-builder-empty" role="status"><Loader2 className="animate-spin" />Loading templates…</div> : library.data?.documents.length ? <><div className="campaign-builder-templateGrid">{templates.map(template => <div className="campaign-builder-templateCard" data-selected={selectedId === template.id} key={`${template.id}:${template.updated_at}`}><button type="button" className="campaign-builder-template" aria-pressed={selectedId === template.id} disabled={!canWrite || opening !== null} onClick={() => void open(template, false)}><TemplatePaper template={template} /><span className="campaign-builder-templateName"><strong>{template.name}</strong>{opening === template.id ? <Loader2 className="animate-spin" /> : selectedId === template.id ? <Check /> : null}</span><small>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "Asia/Shanghai" }).format(new Date(template.updated_at))}</small></button>{canWrite ? <div className="campaign-builder-templateMenu"><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Manage ${template.name}`}><MoreHorizontal /></Button>} /><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => void open(template, false)}><Check />Use template</DropdownMenuItem><DropdownMenuItem onClick={() => void open(template, true)}><Pencil />Edit template</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div> : null}</div>)}</div><div className="campaign-builder-pagination"><Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 60))}>Previous</Button><span>{offset + 1}–{Math.min(offset + templates.length, library.data.total)} of {library.data.total}</span><Button size="sm" variant="outline" disabled={offset + templates.length >= library.data.total} onClick={() => setOffset(value => value + 60)}>Next</Button></div></> : <div className="campaign-builder-empty"><FileText /><p>{query ? "No matching templates" : "No saved email templates"}</p></div>}
    {editor ? <EmailDesignEditor key={editor.template?.id ?? "new"} initial={editor.design} name={name} subject={subject} template={editor.template} products={products} onSave={save} onApply={(next, template) => { onDesignApply(next, template); setEditor(null); }} onClose={() => setEditor(null)} /> : null}
  </div>;
}
