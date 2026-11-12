"use client";

import { useEffect, useState } from "react";
import { FileText, FolderPlus, Loader2, Paperclip, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { documentCategories, type DocumentCategory, type LibraryDocument, type LibraryFolder } from "@/lib/documents";
import { DocumentRecordLinks } from "@/components/document-record-links";
import { emptyDocumentConnections } from "@/lib/document-connections";
import { DocumentLibraryPicker } from "@/components/document-library-picker";

export type DocumentEditorState = { mode: "folder" | "template" | "upload" | "edit"; document?: LibraryDocument; files?: File[]; initial?: Partial<LibraryDocument> };
export function DocumentEditor({ editor, folders, folderId, category: initialCategory, onClose, onSave }: {
  editor: DocumentEditorState; folders: LibraryFolder[]; folderId: string | null;
  onClose: () => void; onSave: (value: Record<string, unknown>, files?: File[]) => Promise<void>;
  category?: DocumentCategory;
}) {
  const document = editor.document ?? editor.initial;
  const isFolder = editor.mode === "folder";
  const isTemplate = editor.mode === "template" || document?.kind === "template";
  const [connections, setConnections] = useState({ ...emptyDocumentConnections, company_id: document?.company_id ?? null, purchase_order_id: document?.purchase_order_id ?? null, invoice_id: document?.invoice_id ?? null, product_skus: document?.product_skus ?? [] });
  const [name, setName] = useState(document?.name ?? (editor.files?.length === 1 ? editor.files[0].name : ""));
  const [folder, setFolder] = useState(document?.folder_id ?? folderId ?? "");
  const [company, setCompany] = useState(document?.company ?? "");
  const [tags, setTags] = useState(document?.tags?.join(", ") ?? "");
  const [description, setDescription] = useState(document?.description ?? "");
  const [subject, setSubject] = useState(document?.subject ?? "");
  const [body, setBody] = useState(document?.body ?? "");
  const [color, setColor] = useState("green");
  const [category, setCategory] = useState(document?.category ?? (isTemplate ? initialCategory === "promotion" ? "promotion" : "everyday" : initialCategory && !["everyday", "promotion"].includes(initialCategory) ? initialCategory : "general"));
  const [relatedIds, setRelatedIds] = useState(document?.related_ids ?? []);
  const [relatedNames, setRelatedNames] = useState<Record<string, string>>({});
  const [pickRelated, setPickRelated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const multi = (editor.files?.length ?? 0) > 1;
  useEffect(() => {
    if (!document?.id || !document.related_ids?.length) return;
    const controller = new AbortController();
    void fetch(`/api/documents/${document.id}?details=1`, { signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const data = await response.json();
      if (!controller.signal.aborted) setRelatedNames(Object.fromEntries(data.related.map((item: LibraryDocument) => [item.id, item.name])));
    }).catch(() => {});
    return () => controller.abort();
  }, [document?.id, document?.related_ids?.length, document?.updated_at]);
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="library-editor-dialog sm:max-w-[560px]">
      <DialogHeader className="library-editor-heading">
        <span className="mb-1 flex size-10 items-center justify-center rounded-xl bg-brand-soft text-primary">{isFolder ? <FolderPlus className="size-5" /> : isTemplate ? <FileText className="size-5" /> : <Upload className="size-5" />}</span>
        <DialogTitle>{isFolder ? "Create a folder" : editor.mode === "edit" ? "Edit details" : isTemplate ? "Create a text template" : `Upload ${multi ? `${editor.files!.length} files` : "a file"}`}</DialogTitle>
        <DialogDescription>{isFolder ? "Give related files a home. Everyone in your workspace can use this folder." : isTemplate ? "Save a message you use often. Copy it whenever you need it." : "Add context now to make this easier to find later."}</DialogDescription>
      </DialogHeader>
      <form className="library-form" onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError("");
        try {
          await onSave({ ...connections, name, folder_id: folder || null, company, tags: [...new Set(tags.split(",").map(tag => tag.trim()).filter(Boolean))], description, subject, body, color, category, related_ids: relatedIds }, editor.files);
          onClose();
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save. Try again."); }
        finally { setBusy(false); }
      }}>
        {!multi ? <label>{isFolder ? "Folder name" : "Name"}<Input autoFocus required maxLength={isFolder ? 80 : 200} value={name} onChange={event => setName(event.target.value)} placeholder={isFolder ? "e.g. Product catalogs" : isTemplate ? "e.g. New customer introduction" : "File name"} /></label> : <div className="library-upload-files">{editor.files!.map((file, index) => <span key={index}><FileText className="size-4" />{file.name}</span>)}</div>}
        {isFolder ? <fieldset><legend className="mb-2 text-xs font-medium">Folder color</legend><div className="flex gap-3">{["green", "blue", "amber", "purple"].map(value => <button key={value} type="button" aria-label={`${value} folder`} aria-pressed={color === value} onClick={() => setColor(value)} className={`library-color color-${value} ${color === value ? "is-picked" : ""}`} />)}</div></fieldset> : <>
          <label>Category<select value={category} onChange={event => setCategory(event.target.value as DocumentCategory)}>{["Business documents", "Shared resources", "Email templates"].map(group => <optgroup key={group} label={group}>{documentCategories.filter(item => item.group === group && (isTemplate ? ["promotion", "everyday", "general"].includes(item.id) : !["promotion", "everyday"].includes(item.id))).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}</select></label>
          {!isTemplate ? <DocumentRecordLinks category={category} value={connections} onChange={setConnections} disabled={busy} /> : null}
          <div className="library-form-row"><label>Folder<select value={folder} onChange={event => setFolder(event.target.value)}><option value="">No folder</option>{folders.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Customer / company<Input maxLength={160} value={company} onChange={event => setCompany(event.target.value)} placeholder="Optional company name" /></label></div>
          <label>Tags<Input value={tags} onChange={event => setTags(event.target.value)} placeholder="e.g. PLA, pricing, 2026 (separate with commas)" /><span className="library-field-hint">Up to 12 tags. Search by any tag, name, or company.</span></label>
          {isTemplate ? <><label>Email subject <span className="text-muted-foreground">(optional)</span><Input maxLength={300} value={subject} onChange={event => setSubject(event.target.value)} placeholder="A subject line for your message" /></label><label>Template content<Textarea required maxLength={12000} rows={8} value={body} onChange={event => setBody(event.target.value)} placeholder={"Hi {{first_name}},\n\nWrite your reusable message here…"} /><span className="library-field-hint">Placeholders such as {"{{first_name}}"} stay as text for you to replace.</span></label></> : null}
          <label>Description <span className="text-muted-foreground">(optional)</span><Textarea maxLength={2000} rows={2} value={description} onChange={event => setDescription(event.target.value)} placeholder="What should your team know about this?" /></label>
          {isTemplate ? <div><div className="mb-2 flex items-center justify-between text-sm"><span>Related attachments</span><Button type="button" size="sm" variant="outline" disabled={relatedIds.length >= 10} onClick={() => setPickRelated(true)}><Paperclip />Link file</Button></div><div className="space-y-2">{relatedIds.map(id => <div key={id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><Paperclip className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{relatedNames[id] || `Linked file · ${id.slice(0, 8)}`}</span><button type="button" aria-label="Remove related file" onClick={() => setRelatedIds(ids => ids.filter(value => value !== id))}><X className="size-4" /></button></div>)}</div><p className="mt-2 text-xs text-muted-foreground">Linked files are attached when you insert this template into an email.</p></div> : null}
        </>}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="library-editor-footer"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button size="sm" disabled={busy} type="submit">{busy ? <Loader2 className="size-4 animate-spin" /> : null}{busy ? "Saving…" : isFolder ? "Create folder" : "Save changes"}</Button></div>
      </form>
      {pickRelated ? <DocumentLibraryPicker filesOnly onClose={() => setPickRelated(false)} onSelect={file => { setRelatedIds(ids => [...new Set([...ids, file.id])]); setRelatedNames(names => ({ ...names, [file.id]: file.name })); }} /> : null}
    </DialogContent>
  </Dialog>;
}
