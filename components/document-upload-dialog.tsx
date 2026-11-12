"use client";

import { useRef, useState } from "react";
import { AlertCircle, Check, CheckCircle2, ChevronDown, FolderOpen, Loader2, Plus, ShieldCheck, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DocumentRecordLinks } from "@/components/document-record-links";
import { emptyDocumentConnections, documentConnectionError } from "@/lib/document-connections";
import { DocumentFileIcon } from "@/components/document-file-icon";
import { documentMetadataSchema, documentCategories, formatDocumentSize, type DocumentCategory, type LibraryFolder } from "@/lib/documents";
import { addDocumentUploadFiles } from "@/lib/document-upload";

export type DocumentUploadStatus = "queued" | "uploading" | "saving" | "completed" | "error";
export type DocumentUploadReporter = (file: File, status: DocumentUploadStatus, error?: string) => void;
type QueuedFile = { id: string; file: File; name: string; status: DocumentUploadStatus; error?: string };

export function DocumentUploadDialog({ initialFiles = [], folders, folderId, category: initialCategory, onClose, onSave }: {
  initialFiles?: File[]; folders: LibraryFolder[]; folderId: string | null; category?: DocumentCategory;
  onClose: () => void; onSave: (value: Record<string, unknown>, files: File[], report: DocumentUploadReporter) => Promise<void>;
}) {
  const [initialSelection] = useState(() => addDocumentUploadFiles<File>([], initialFiles));
  const [files, setFiles] = useState<QueuedFile[]>(() => initialSelection.files.map((file, index) => ({ id: `initial-${index}`, file, name: file.name, status: "queued" })));
  const [category, setCategory] = useState<DocumentCategory>(initialCategory && !["promotion", "everyday"].includes(initialCategory) ? initialCategory : "general");
  const [connections, setConnections] = useState(emptyDocumentConnections);
  const [folder, setFolder] = useState(folderId ?? "");
  const [tags, setTags] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [validation, setValidation] = useState(initialSelection.messages.join("\n"));
  const input = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  const pending = files.filter(item => item.status !== "completed");
  const completed = files.length - pending.length;
  const allComplete = files.length > 0 && pending.length === 0;
  const destination = documentCategories.find(item => item.id === category)?.label ?? "Other files";
  const connectionIssue = documentConnectionError(category, connections);
  const requiredLinks = ["quotation", "catalog", "datasheet", "proforma", "invoice", "payment", "purchase_order"].includes(category);
  const [optionalLinks, setOptionalLinks] = useState(false);
  function addFiles(incoming: File[]) {
    if (busy || completed > 0) return;
    const selection = addDocumentUploadFiles(files.map(item => item.file), incoming);
    setValidation(selection.messages.join("\n"));
    setFiles(current => [...current, ...selection.files.slice(files.length).map(file => ({ id: crypto.randomUUID(), file, name: file.name, status: "queued" as const }))]);
    setError("");
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="library-upload-dialog sm:max-w-[600px]" showCloseButton={false} onClick={event => event.stopPropagation()} onDragEnter={event => event.stopPropagation()} onDragOver={event => { event.preventDefault(); event.stopPropagation(); }} onDrop={event => { event.preventDefault(); event.stopPropagation(); setDragging(false); addFiles(Array.from(event.dataTransfer.files)); }}>
    <DialogHeader className="library-upload-header"><span className="library-dialog-symbol"><UploadCloud /></span><div><DialogTitle>Upload files</DialogTitle><DialogDescription>Add files to your workspace library.</DialogDescription></div><Button variant="ghost" size="icon-sm" aria-label="Close upload dialog" disabled={busy} onClick={onClose}><X /></Button></DialogHeader>
    <form className="library-upload-form" onSubmit={async event => {
      event.preventDefault();
      if (!pending.length || saving.current) return;
      const issue = documentConnectionError(category, connections);
      if (issue) { setError(issue); return; }
      const parsedTags = [...new Set(tags.split(",").map(tag => tag.trim()).filter(Boolean))];
      if (parsedTags.length > 12 || parsedTags.some(tag => tag.length > 40)) { setError("Use up to 12 tags, with no more than 40 characters per tag."); return; }
      for (const item of pending) {
        const result = documentMetadataSchema.safeParse({ name: item.name, tags: parsedTags, description, category, folder_id: folder || null });
        if (!result.success) { setError(`${item.file.name}: ${result.error.issues[0]?.message ?? "Check file details."}`); return; }
      }
      saving.current = true; setBusy(true); setError("");
      try {
        await onSave({ ...connections, name: pending[0].name.trim(), file_names: pending.map(item => item.name.trim()), folder_id: folder || null, category, company: "", tags: parsedTags, description, subject: "", body: "", related_ids: [] }, pending.map(item => item.file), (file, status, error) => setFiles(current => current.map(item => item.file === file ? { ...item, status, error } : item)));
      } catch (cause) {
        setFiles(current => current.map(item => item.status === "uploading" || item.status === "saving" ? { ...item, status: "error" } : item));
        setError(cause instanceof Error ? cause.message : "Upload failed. Try again.");
      } finally { saving.current = false; setBusy(false); }
    }}>
      <div className="library-upload-body">
      <input ref={input} type="file" multiple className="sr-only" aria-label="Choose files to upload" disabled={busy} onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      {!allComplete ? <button type="button" className={`library-upload-dropzone ${dragging ? "is-dragging" : ""}`} disabled={busy || completed > 0} onClick={() => input.current?.click()} onDragEnter={event => { event.preventDefault(); setDragging(true); }} onDragOver={event => event.preventDefault()} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false); }} onDrop={event => { event.preventDefault(); event.stopPropagation(); setDragging(false); addFiles(Array.from(event.dataTransfer.files)); }}>
        <span className="library-drop-symbol"><UploadCloud /></span><strong>{dragging ? "Drop to add your files" : "Choose files or drag them here"}</strong><span>PDF, spreadsheets, documents, images, and more</span><small>Up to 20 files · 50 MB per file</small><span className="library-browse-label"><Plus />Browse files</span>
      </button> : null}
      {validation ? <p role="alert" className="library-upload-validation"><AlertCircle />{validation}</p> : null}
      {files.length ? <section className="library-upload-queue" aria-label="Upload queue"><div className="library-queue-heading"><span>{files.length} file{files.length === 1 ? "" : "s"} selected <small>· {formatDocumentSize(files.reduce((total, item) => total + item.file.size, 0))}</small></span>{busy ? <span role="status">{completed} of {files.length} saved</span> : allComplete ? <span className="library-upload-saved"><CheckCircle2 />All files saved</span> : <button type="button" onClick={() => { setFiles(current => current.filter(item => item.status === "completed")); setError(""); setValidation(""); }}>Clear pending</button>}</div><ul>{files.map(item => <li key={item.id} className={`upload-status-${item.status}`}><DocumentFileIcon document={{ name: item.file.name, mime_type: item.file.type }} size={30} /><div className="library-queue-file"><Input aria-label={`File name for ${item.file.name}`} maxLength={200} value={item.name} disabled={busy || item.status === "completed"} onChange={event => setFiles(current => current.map(file => file.id === item.id ? { ...file, name: event.target.value } : file))} className="h-8" /><span>{formatDocumentSize(item.file.size)}<i>·</i>{item.status === "completed" ? "Saved to library" : item.status === "saving" ? "Saving file details" : item.status === "uploading" ? "Uploading…" : item.status === "error" ? "Upload failed · ready to retry" : "Ready to upload"}</span>{item.status === "error" && item.error ? <p>{item.error}</p> : null}{(item.status === "uploading" || item.status === "saving") ? <div className="library-upload-indeterminate" role="status" aria-label={`Uploading ${item.file.name}`}><span /></div> : null}</div>{item.status === "completed" ? <CheckCircle2 className="library-upload-saved size-4" /> : (item.status === "uploading" || item.status === "saving") ? <Loader2 className="size-4 animate-spin text-primary" /> : <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${item.file.name} from queue`} disabled={busy} onClick={() => { setFiles(current => current.filter(file => file.id !== item.id)); setError(""); }}><X /></Button>}</li>)}</ul></section> : null}
      <fieldset disabled={busy || completed > 0} className="library-upload-destination space-y-3"><legend>Save to</legend>
        <div className="grid gap-3 sm:grid-cols-2"><label className="space-y-1.5 text-xs font-medium">Category<Select value={category} disabled={busy || completed > 0} onValueChange={value => { if (value) { setCategory(value as DocumentCategory); setConnections(emptyDocumentConnections); setOptionalLinks(false); setError(""); } }}><SelectTrigger aria-label="Upload category" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{["Business documents", "Shared resources"].map(group => <SelectGroup key={group}><SelectLabel>{group}</SelectLabel>{documentCategories.filter(item => item.group === group).map(item => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectGroup>)}</SelectContent></Select></label>
        <label className="space-y-1.5 text-xs font-medium">Folder (optional)<Select value={folder || "none"} disabled={busy || completed > 0} onValueChange={value => setFolder(value === "none" ? "" : value ?? "")}><SelectTrigger aria-label="Upload folder" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No folder</SelectItem>{folders.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label></div>
        <p className="library-destination-hint"><FolderOpen />{destination}{folder ? ' / ' + folders.find(item => item.id === folder)?.name : ""}</p>
        <p className="text-xs text-muted-foreground">All files use this destination and the same linked records. Upload separately for different customers or categories.</p>
        {requiredLinks || optionalLinks ? <DocumentRecordLinks key={category} category={category} value={connections} onChange={setConnections} disabled={busy || completed > 0} /> : <Button type="button" variant="ghost" size="sm" disabled={busy || completed > 0} onClick={() => setOptionalLinks(true)}><Plus />Link a customer or product (optional)</Button>}
        {connectionIssue ? <p className="text-xs text-muted-foreground">{connectionIssue}</p> : null}
      </fieldset>
      <details className="library-upload-extra mx-6 my-4"><summary>Tags and description (optional)<ChevronDown /></summary><fieldset disabled={busy || completed > 0} className="mt-3 space-y-3"><label className="block space-y-1 text-xs">Tags<Input value={tags} onChange={event => setTags(event.target.value)} placeholder="PLA, pricing, 2026" /><span className="text-muted-foreground">Separate with commas. Up to 12 tags.</span></label><label className="block space-y-1 text-xs">Description<Textarea maxLength={2000} rows={2} value={description} onChange={event => setDescription(event.target.value)} placeholder="What should your team know?" /></label></fieldset></details>
      {files.length ? <div className="mx-6 mb-4 space-y-1" role="status" aria-live="polite"><p className="text-xs text-muted-foreground">{completed} of {files.length} files saved</p><progress aria-label="Files saved" max={files.length} value={completed} className="h-1.5 w-full accent-primary" /></div> : null}
      {error ? <p role="alert" className="library-upload-error"><AlertCircle />{error}</p> : null}
      </div>
      <div className="library-upload-footer"><span><ShieldCheck />Workspace members only</span><div><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { if (allComplete) { setFiles([]); setError(""); setValidation(""); } else onClose(); }}>{allComplete ? "Upload more" : completed ? "Close" : "Cancel"}</Button>{allComplete ? <Button type="button" size="sm" onClick={onClose}><Check />Done</Button> : <Button type="submit" size="sm" disabled={busy || !pending.length || !!connectionIssue}>{busy ? <Loader2 className="animate-spin" /> : <UploadCloud />}{busy ? "Uploading…" : pending.some(item => item.status === "error") ? "Retry unsaved files" : `Upload${pending.length ? ` ${pending.length} file${pending.length === 1 ? "" : "s"}` : " files"}`}</Button>}</div></div>
    </form>
  </DialogContent></Dialog>;
}
