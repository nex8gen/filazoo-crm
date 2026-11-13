"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Check, ChevronDown, Code, FileText, Loader2, Mail, Monitor, Smartphone, MoreHorizontal, Pencil, Eye, Save, Plus, RefreshCw, Search, Type } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { personalizeCampaign, type CampaignRecipient } from "@/lib/email-campaigns";
import { embeddedCampaignPreheader } from "@/lib/campaign-message-tools";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useDocumentLibrary } from "@/components/use-document-library";
import { emailDesignText, newEmailDesign, renderEmailDesign, type EmailDesign } from "@/lib/email-design";
import { isBuiltinEmailTemplate, type LibraryDocument } from "@/lib/documents";
import type { Product as MarketingProduct } from "@/lib/types";
import { campaignDesignerRecoverySchema, clearCampaignSession, readCampaignSession, writeCampaignSession, type CampaignDesignerRecovery } from "@/lib/campaign-editor-session";

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
    if (template.design_version && !template.email_design && !template.preview_url) void fullTemplate(template).then(value => { if (active) setDesign(value.email_design ?? null); }).catch(() => {});
    return () => { active = false; };
  }, [template]);
  return <span className="campaign-builder-templatePaper">{template.preview_url ? <iframe title={`${template.name} thumbnail`} sandbox="allow-same-origin" loading="lazy" tabIndex={-1} src={template.preview_url} /> : design ? <iframe title={`${template.name} thumbnail`} sandbox="allow-same-origin" loading="lazy" tabIndex={-1} srcDoc={renderEmailDesign(design, { preview: true }).html} /> : <><Mail /><strong>{template.subject || template.name}</strong><span>{template.body}</span></>}</span>;
}

export function CampaignTemplateLibrary({ selectedId, onSelect, onDesignApply, canWrite, design, body, name, subject, products, sessionKey, recoverDesigner, view = "library", onBrowseTemplates, onWriteMessage, preheader, subjectB, plainText, onPlainTextChange, onTextOnly, previewRecipients = [] }: { selectedId: string | null; onSelect: (template: LibraryDocument) => void; onDesignApply: (design: EmailDesign, template?: LibraryDocument | null) => void; canWrite: boolean; design?: EmailDesign; body: string; name: string; subject: string; products: MarketingProduct[]; sessionKey: string; recoverDesigner: boolean; view?: "library" | "preview"; onBrowseTemplates?: () => void; onWriteMessage?: () => void; preheader?: string; subjectB?: string; plainText?: string; onPlainTextChange?: (value: string | undefined) => void; onTextOnly?: () => void; previewRecipients?: CampaignRecipient[] }) {
  const [modal, setModal] = useState<"preview" | "plain" | "save" | "textOnly" | null>(null);
  const [plainDraft, setPlainDraft] = useState("");
  const [templateName, setTemplateName] = useState(name);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [actionError, setActionError] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [variant, setVariant] = useState<"A" | "B">("A");
  const selectedSubject = subjectB !== undefined && variant === "B" ? subjectB : subject;
  const recipient = previewRecipients.find(item => item.id === recipientId) ?? previewRecipients[0] ?? { id: "sample", name: "Alex Taylor", companyName: "Example company", email: "alex@example.com" };
  const previewHtml = design ? renderEmailDesign(design, { preview: true, personalize: value => personalizeCampaign(value, recipient), preheader: embeddedCampaignPreheader(design) ? undefined : preheader }).html : undefined;
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ design: EmailDesign; template?: LibraryDocument | null; recovery?: CampaignDesignerRecovery } | null>(() => {
    const recovery = canWrite && recoverDesigner ? readCampaignSession(`${sessionKey}:designer`, campaignDesignerRecoverySchema) : null;
    return recovery ? { design: recovery.initial, template: recovery.template, recovery } : null;
  });
  function closeEditor() { clearCampaignSession(`${sessionKey}:designer`); setEditor(null); }
  const params = new URLSearchParams({ view: "templates", sort: "newest", q: query });
  const library = useDocumentLibrary(params.toString(), offset, revision);
  const templates = (library.data?.documents.length ?? 0) > 60 ? library.data!.documents.slice(offset, offset + 60) : library.data?.documents ?? [];
  async function open(template: LibraryDocument, edit: boolean) {
    if (!canWrite) return;
    setOpening(template.id);
    try { const complete = await fullTemplate(template); if (edit) setEditor({ design: complete.email_design ?? newEmailDesign(complete.body, "text"), template: isBuiltinEmailTemplate(complete) ? null : complete }); else onSelect(complete); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Unable to open the template."); }
    finally { setOpening(null); }
  }
  async function save(next: EmailDesign, title: string, existing?: LibraryDocument | null) {
    if (!canWrite) throw new Error("You have view-only access to this campaign.");
    if (existing && isBuiltinEmailTemplate(existing)) existing = null;
    const response = await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(existing ?? {}), action: existing ? "update" : "create", id: existing?.id ?? crypto.randomUUID(), kind: "template", name: title, category: existing?.category ?? "everyday", subject, body: emailDesignText(next), email_design: next }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Unable to save the template.");
    setRevision(value => value + 1); library.invalidate(); toast.success("Email template saved");
    return result.document as LibraryDocument;
  }
  async function saveAsTemplate() {
    if (!templateName.trim()) { setActionError("Give the template a name."); return; }
    setSavingTemplate(true); setActionError("");
    try { await save(design ?? newEmailDesign(body, "text"), templateName.trim()); setModal(null); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : "Unable to save the template."); }
    finally { setSavingTemplate(false); }
  }
  return <div className={`campaign-builder-templates${view === "preview" ? " is-preview" : ""}`}>
    {view === "preview" ? <>
      <div className="campaign-builder-previewToolbar"><div className="campaign-builder-deviceToggle" role="group" aria-label="Email preview size"><Button size="icon-sm" variant={device === "desktop" ? "secondary" : "ghost"} aria-label="Desktop preview" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")}><Monitor /></Button><Button size="icon-sm" variant={device === "mobile" ? "secondary" : "ghost"} aria-label="Mobile preview" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")}><Smartphone /></Button></div><div className="campaign-builder-previewActions">{subjectB !== undefined ? <div className="campaign-builder-deviceToggle" role="group" aria-label="Subject variant">{(["A", "B"] as const).map(item => <Button key={item} size="sm" variant={variant === item ? "secondary" : "ghost"} aria-pressed={variant === item} onClick={() => setVariant(item)}>Variant {item}</Button>)}</div> : null}{canWrite ? <Button variant="outline" size="sm" onClick={() => setEditor({ design: design ?? newEmailDesign(body, "text") })}><Pencil />Edit email</Button> : null}<DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" aria-label="Message actions"><MoreHorizontal /></Button>} /><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => setModal("preview")}><Eye />Preview email</DropdownMenuItem>{canWrite ? <><DropdownMenuItem onClick={() => { setPlainDraft(plainText ?? (design ? emailDesignText(design) : body)); setActionError(""); setModal("plain"); }}><Type />Edit plain text version</DropdownMenuItem><DropdownMenuItem onClick={() => { setTemplateName(name); setActionError(""); setModal("save"); }}><Save />Save as template</DropdownMenuItem><DropdownMenuItem onClick={() => setEditor({ design: design ?? newEmailDesign(body, "text") })}><Mail />Switch to drag-and-drop editor</DropdownMenuItem><DropdownMenuItem onClick={() => design ? setModal("textOnly") : onTextOnly?.()}><Type />Switch to text only editor</DropdownMenuItem></> : null}<DropdownMenuItem onClick={onBrowseTemplates}><FileText />Choose template</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div>
      <div className="campaign-builder-previewStage"><div className="campaign-builder-previewPaper" data-device={device}><div className="campaign-builder-previewSubject"><strong>{selectedSubject || "Subject line"}</strong>{preheader ? <p>{preheader}</p> : null}</div>{design ? <iframe title="Campaign email preview" sandbox="allow-same-origin" srcDoc={renderEmailDesign(design, { preview: true }).html} /> : <article className="campaign-builder-textPreview">{body}</article>}</div></div>
    </> : <><div className="campaign-builder-templateToolbar"><div className="campaign-builder-templateSearch"><Search /><Input aria-label="Search email templates" placeholder="Search templates" value={query} onChange={event => { setQuery(event.target.value); setOffset(0); }} /></div>{canWrite ? <>{body || design ? <Button variant="outline" size="sm" onClick={() => setEditor({ design: design ?? newEmailDesign(body, "text") })}><Pencil />Edit email</Button> : null}<DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="sm"><Plus />Create<ChevronDown /></Button>} /><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => setEditor({ design: newEmailDesign() })}><Mail />Drag-and-drop email</DropdownMenuItem><DropdownMenuItem onClick={() => setEditor({ design: newEmailDesign("", "html") })}><Code />HTML email</DropdownMenuItem><DropdownMenuItem onClick={() => setEditor({ design: newEmailDesign("", "text") })}><Type />Text email</DropdownMenuItem></DropdownMenuContent></DropdownMenu></> : null}</div>
    <div className="campaign-builder-libraryBody">{library.error ? <NotificationToast><p>{library.error}</p><Button size="sm" variant="outline" onClick={() => setRevision(value => value + 1)}><RefreshCw />Try again</Button></NotificationToast> : library.loading ? <div className="campaign-builder-empty" role="status"><Loader2 className="animate-spin" />Loading templates…</div> : library.data?.documents.length ? <><div className="campaign-builder-templateGrid">{templates.map(template => <div className="campaign-builder-templateCard" data-selected={selectedId === template.id} key={`${template.id}:${template.updated_at}`}><button type="button" className="campaign-builder-template" aria-pressed={selectedId === template.id} disabled={!canWrite || opening !== null} onClick={() => void open(template, false)}><TemplatePaper template={template} /><span className="campaign-builder-templateName"><strong>{template.name}</strong>{opening === template.id ? <Loader2 className="animate-spin" /> : selectedId === template.id ? <Check /> : null}</span><small>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "Asia/Shanghai" }).format(new Date(template.updated_at))}</small></button>{canWrite ? <div className="campaign-builder-templateMenu"><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Manage ${template.name}`}><MoreHorizontal /></Button>} /><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => void open(template, false)}><Check />Use template</DropdownMenuItem><DropdownMenuItem onClick={() => void open(template, true)}><Pencil />{isBuiltinEmailTemplate(template) ? "Customize a copy" : "Edit template"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div> : null}</div>)}</div><div className="campaign-builder-pagination"><Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 60))}>Previous</Button><span>{offset + 1}–{Math.min(offset + templates.length, library.data.total)} of {library.data.total}</span><Button size="sm" variant="outline" disabled={offset + templates.length >= library.data.total} onClick={() => setOffset(value => value + 60)}>Next</Button></div></> : <div className="campaign-builder-templateStart"><span className="campaign-builder-startIcon"><Mail /></span><h3>{query ? "No matching templates" : "Create your email message"}</h3><p>{query ? "Try another search or start a new email." : "Start with a new design, paste your HTML, or write a simple text email. Saved templates will appear here."}</p>{canWrite ? <div className="campaign-builder-startOptions"><button type="button" onClick={() => setEditor({ design: newEmailDesign() })}><Mail /><strong>Drag-and-drop email</strong><span>Build with images, text, and buttons</span></button><button type="button" onClick={() => setEditor({ design: newEmailDesign("", "html") })}><Code /><strong>HTML email</strong><span>Use your own email HTML</span></button><button type="button" onClick={onWriteMessage}><Type /><strong>Text email</strong><span>Write a personal, simple message</span></button></div> : null}{query ? <Button variant="ghost" size="sm" onClick={() => { setQuery(""); setOffset(0); }}>Clear search</Button> : null}</div>}
    </div></>}
    <Dialog open={modal !== null} onOpenChange={open => { if (!open && !savingTemplate) setModal(null); }}><DialogContent className={modal === "preview" ? "campaign-message-fullPreview !max-w-[min(1000px,calc(100%-2rem))]" : "!max-w-xl"}>
      <DialogHeader><DialogTitle>{modal === "preview" ? "Preview email" : modal === "plain" ? "Edit plain text version" : modal === "save" ? "Save as template" : "Switch to text only editor?"}</DialogTitle><DialogDescription>{modal === "preview" ? "Preview personalization for a selected recipient. No email is sent." : modal === "plain" ? "This version accompanies the designed email for recipients who read plain text." : modal === "save" ? "Save a reusable copy in Email templates." : "Your text and links will be kept. Images and layout will be removed from this campaign; saved templates stay unchanged."}</DialogDescription></DialogHeader>
      {modal === "preview" ? <><div className="campaign-builder-previewControls"><label className="campaign-builder-field">Preview recipient<select value={recipientId || recipient.id} onChange={event => setRecipientId(event.target.value)}>{previewRecipients.length ? previewRecipients.map(item => <option key={item.id} value={item.id}>{item.name || item.email}</option>) : <option value="sample">Sample recipient</option>}</select></label><div className="campaign-builder-deviceToggle" role="group" aria-label="Preview format"><Button size="sm" variant={device === "desktop" ? "secondary" : "ghost"} onClick={() => setDevice("desktop")}>Desktop</Button><Button size="sm" variant={device === "mobile" ? "secondary" : "ghost"} onClick={() => setDevice("mobile")}>Mobile</Button></div></div><div className="campaign-builder-previewStage"><div className="campaign-builder-previewPaper" data-device={device}><div className="campaign-builder-previewSubject"><strong>{personalizeCampaign(selectedSubject, recipient) || "Subject line"}</strong>{preheader ? <p>{personalizeCampaign(preheader, recipient)}</p> : null}</div>{previewHtml ? <iframe title="Personalized email preview" sandbox="allow-same-origin" srcDoc={previewHtml} /> : <article className="campaign-builder-textPreview">{personalizeCampaign(body, recipient)}</article>}</div></div></> : null}
      {modal === "plain" ? <><Textarea aria-label="Plain text version" rows={12} maxLength={12000} value={plainDraft} disabled={!canWrite} onChange={event => setPlainDraft(event.target.value)} /><DialogFooter><Button variant="outline" disabled={!canWrite} onClick={() => { onPlainTextChange?.(undefined); setModal(null); }}>Use automatic version</Button><Button disabled={!canWrite || !plainDraft.trim()} onClick={() => { onPlainTextChange?.(plainDraft); setModal(null); }}>Save plain text</Button></DialogFooter></> : null}
      {modal === "save" ? <form className="space-y-4" onSubmit={event => { event.preventDefault(); void saveAsTemplate(); }}><label className="campaign-builder-field">Template name<Input required maxLength={200} value={templateName} disabled={savingTemplate} onChange={event => setTemplateName(event.target.value)} /></label>{actionError ? <NotificationToast>{actionError}</NotificationToast> : null}<DialogFooter><Button type="button" variant="outline" disabled={savingTemplate} onClick={() => setModal(null)}>Cancel</Button><Button type="submit" disabled={savingTemplate || !canWrite}>{savingTemplate ? <Loader2 className="animate-spin" /> : <Save />}Save template</Button></DialogFooter></form> : null}
      {modal === "textOnly" ? <DialogFooter><Button variant="outline" onClick={() => setModal(null)}>Keep design</Button><Button disabled={!canWrite} onClick={() => { onTextOnly?.(); setModal(null); }}>Switch to text only</Button></DialogFooter> : null}
    </DialogContent></Dialog>
    {editor ? <EmailDesignEditor key={editor.template?.id ?? "new"} initial={editor.design} recovery={editor.recovery} onCheckpoint={value => writeCampaignSession(`${sessionKey}:designer`, value)} name={name} subject={subject} template={editor.template} products={products} onSave={save} onApply={(next, template) => { onDesignApply(next, template); closeEditor(); }} onClose={closeEditor} /> : null}
  </div>;
}
