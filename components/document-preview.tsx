/* eslint-disable @next/next/no-img-element -- Private preview URLs are signed on demand and must not use the image optimization cache. */
"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowDownToLine, Check, Copy, ExternalLink, FileText, FolderOpen, Loader2, Mail, Pencil, RotateCcw, ShieldCheck, Star, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";
import { documentSourceHref, documentSizeLabel } from "@/lib/document-connections";
import { DocumentFileIcon } from "@/components/document-file-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canPreviewDocument, documentCategories, formatDocumentSize, type LibraryDocument, type LibraryFolder } from "@/lib/documents";

const DocumentPdfPreview = dynamic(() => import("@/components/document-pdf-preview").then(module => module.DocumentPdfPreview), { ssr: false, loading: () => <div className="library-preview-unavailable"><Loader2 className="animate-spin" /><p>Loading PDF viewer…</p></div> });

export function DocumentPreview({ document, folders, canWrite, onClose, onEdit, onStar, onTrash, onRestore, onUseInEmail, onSelectRelated }: {
  document: LibraryDocument | null; folders: LibraryFolder[]; canWrite: boolean; onClose: () => void;
  onEdit: () => void; onStar: () => void; onTrash: () => void; onRestore: () => void;
  onUseInEmail: () => void; onSelectRelated: (document: LibraryDocument) => void;
}) {
  const [preview, setPreview] = useState<{ id: string; url?: string; error?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [related, setRelated] = useState<LibraryDocument[]>([]);
  const [relatedError, setRelatedError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const id = document?.id, mime = document?.mime_type, deleted = document?.deleted_at;
  const previewable = !!mime && canPreviewDocument(mime);
  useEffect(() => {
    if (!id || !document?.related_ids.length || deleted) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/documents/${id}?details=1`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (!controller.signal.aborted) { setRelated(result.related); setRelatedError(""); }
      } catch (error) { if (!controller.signal.aborted) setRelatedError(error instanceof Error ? error.message : "Unable to load related files."); }
    })();
    return () => controller.abort();
  }, [id, document?.related_ids.length, document?.updated_at, deleted]);
  useEffect(() => {
    if (!id || !previewable || deleted) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/documents/${id}`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (!controller.signal.aborted) setPreview({ id, url: result.url });
      } catch (error) { if (!controller.signal.aborted) setPreview({ id, error: error instanceof Error ? error.message : "Unable to load preview." }); }
    })();
    return () => controller.abort();
  }, [id, previewable, deleted, attempt]);
  if (!document) return <div className="library-preview-empty"><div className="library-preview-art"><FileText /></div><h3>Select a file to preview</h3><p>Preview documents, view related attachments, and use files or templates in an email.</p><span className="library-private-note"><ShieldCheck />Workspace members only</span></div>;
  const sourceHref = documentSourceHref(document);
  const binary = document.mime_type !== "application/x-filazoo-record";
  const template = document.kind === "template";
  const folder = folders.find(item => item.id === document.folder_id);
  async function copy() {
    try { await navigator.clipboard.writeText(document!.body); setCopied(true); toast.success("Template copied. Replace any placeholders before using it."); }
    catch { toast.error("Could not copy. Select the text and copy it manually."); }
  }
  async function download() {
    setDownloading(true);
    try {
      if (template) {
        const url = URL.createObjectURL(new Blob([document!.subject ? `Subject: ${document!.subject}\n\n${document!.body}` : document!.body], { type: "text/plain;charset=utf-8" }));
        const a = window.document.createElement("a"); a.href = url; a.download = `${document!.name}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const response = await fetch(`/api/documents/${id}?download=1`); const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        const a = window.document.createElement("a"); a.href = result.url; a.rel = "noopener"; a.target = "_blank"; a.click();
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : "Download failed."); }
    finally { setDownloading(false); }
  }
  const currentPreview = preview?.id === id ? preview : null;
  return <>
    <div className="library-preview-heading"><span>File preview</span><button type="button" aria-label="Close preview" onClick={onClose}><X /></button></div>
    <div className="library-preview-body">
      <div className="library-preview-file-heading"><DocumentFileIcon document={document} size={38} /><div><h3>{document.name}</h3><p>{template ? "Reusable text template" : documentSizeLabel(document) || `${mime === "application/pdf" ? "PDF document" : document.name.split(".").pop()?.toUpperCase() + " file"} · ${formatDocumentSize(document.size)}`}</p></div></div>
      {sourceHref ? <div className="library-source-banner"><span>{document.source_type === "invoice" && document.source_status === "draft" ? "Draft invoice · updates with purchase order" : document.source_status ? `Live CRM document · ${document.source_status.replaceAll("_", " ")}` : "Live CRM document"}</span><Link href={sourceHref}>Open source record<ExternalLink className="size-3.5" /></Link></div> : null}
      {deleted ? <div className="library-preview-unavailable"><Trash2 /><p>This item is in trash.</p><span>Restore it to preview, edit, or download.</span></div> : template ? <div className="library-template-paper">{document.subject ? <div className="library-template-subject"><small>SUBJECT</small><strong>{document.subject}</strong></div> : null}<p>{document.body}</p></div> : previewable ? currentPreview?.error ? <div className="library-preview-unavailable"><p>{currentPreview.error}</p><Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>Retry preview</Button></div> : currentPreview?.url ? <div className="library-media-preview">{expanded ? <Button variant="ghost" className="w-full" onClick={() => setExpanded(false)}>Preview is expanded · Return here</Button> : <DocumentMedia mime={mime!} url={currentPreview.url} name={document.name} onRefresh={() => setAttempt(value => value + 1)} />}</div> : <div className="library-preview-unavailable"><Loader2 className="animate-spin" /><p>Loading preview…</p></div> : <div className="library-preview-unavailable"><FileText /><p>{binary ? "Preview unavailable for this file type" : document.source_type === "payment" ? "Recorded payment" : "Purchase order record"}</p><span>{binary ? "Use Download file to open it in its original app." : document.description}</span></div>}
      {deleted ? canWrite ? <Button className="w-full" onClick={onRestore}><RotateCcw className="size-4" />Restore file</Button> : null : binary ? <div className="library-preview-actions"><Button className="w-full" disabled={downloading} onClick={template ? copy : download}>{template ? copied ? <Check /> : <Copy /> : downloading ? <Loader2 className="animate-spin" /> : <ArrowDownToLine />}{template ? copied ? "Copied to clipboard" : "Copy template" : "Download file"}</Button>{template ? <Button variant="outline" aria-label="Download template as text" onClick={download}><ArrowDownToLine /></Button> : currentPreview?.url ? <Button variant="outline" aria-label="Expand file preview" onClick={() => setExpanded(true)}><ExternalLink /></Button> : null}</div> : null}
      {!deleted && canWrite && binary ? <Button variant="outline" className="mt-2 w-full" disabled={!template && document.size > 7500000} onClick={onUseInEmail}><Mail />{template ? "Use template in email" : "Attach to an email"}</Button> : null}
      {!deleted && document.size > 7500000 ? <p className="mt-2 text-xs text-muted-foreground">Email attachments support files up to 7.5 MB.</p> : null}
      {document.related_ids.length ? <div className="library-detail-section"><h4>Related attachments</h4>{relatedError ? <p className="text-xs text-destructive">{relatedError}</p> : related.length ? <div className="space-y-2">{related.map(file => <button type="button" key={file.id} onClick={() => onSelectRelated(file)} className="flex w-full items-center gap-2 rounded-lg border p-2.5 text-left text-sm hover:bg-muted"><DocumentFileIcon document={file} size={26} /><span className="min-w-0 flex-1 truncate">{file.name}</span></button>)}</div> : <p className="text-xs text-muted-foreground">No active linked files.</p>}</div> : null}
      <div className="library-detail-section"><h4>Category</h4><p className="text-sm">{documentCategories.find(item => item.id === document.category)?.label ?? "Other files"}</p></div>
      <div className="library-detail-section"><h4>Details</h4><dl><div><dt>Folder</dt><dd><FolderOpen />{folder?.name ?? "No folder"}</dd></div><div><dt>Company</dt><dd>{document.company || "Not linked"}</dd></div><div><dt>Updated</dt><dd>{new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "Asia/Shanghai" }).format(new Date(document.updated_at))}</dd></div><div><dt>Access</dt><dd><ShieldCheck />Workspace members</dd></div></dl></div>
      {document.purchase_order_id ? <div className="library-detail-section"><h4>Purchase order</h4><Link className="text-sm text-primary underline" href={`/purchase-orders/${document.purchase_order_id}`}>Open linked order</Link></div> : null}
      {document.company_id ? <div className="library-detail-section"><h4>Customer</h4><Link className="text-sm text-primary underline" href={`/companies/${document.company_id}`}>{document.company || "Open customer"}</Link></div> : null}
      {document.product_skus?.length ? <div className="library-detail-section"><h4>Related products</h4><div className="library-tags">{document.product_skus.map(sku => <span key={sku}>{sku}</span>)}</div></div> : null}
      <div className="library-detail-section"><h4>Tags</h4><div className="library-tags">{document.tags.length ? document.tags.map(tag => <span key={tag}>{tag}</span>) : <p className="text-xs text-muted-foreground">No tags yet. Add tags in Edit details.</p>}</div></div>
      {document.description ? <div className="library-detail-section"><h4>About this file</h4><p className="library-description">{document.description}</p></div> : null}
      {!deleted ? <div className="library-detail-section library-detail-controls"><Button size="sm" variant="outline" onClick={onStar}><Star className={document.starred ? "fill-amber-400 text-amber-500" : ""} />{document.starred ? "Starred" : "Add to starred"}</Button>{canWrite && !document.source_type ? <><Button size="sm" variant="outline" onClick={onEdit}><Pencil />Edit details</Button><Button size="sm" variant="ghost" className="text-destructive" onClick={onTrash}><Trash2 />Move to trash</Button></> : null}</div> : null}
    </div>
    <Dialog open={expanded} onOpenChange={setExpanded}><DialogContent className="library-expanded-preview sm:max-w-5xl"><DialogHeader><DialogTitle>{document.name}</DialogTitle><DialogDescription>File preview</DialogDescription></DialogHeader>{currentPreview?.url && expanded ? <DocumentMedia mime={mime!} url={currentPreview.url} name={document.name} onRefresh={() => setAttempt(value => value + 1)} /> : null}</DialogContent></Dialog>
  </>;
}

function DocumentMedia({ mime, url, name, onRefresh }: { mime: string; url: string; name: string; onRefresh: () => void }) {
  const [failed, setFailed] = useState(false);
  if (mime === "application/pdf") return <DocumentPdfPreview url={url} name={name} onRefresh={onRefresh} />;
  if (failed) return <div className="library-preview-unavailable"><p>The image could not be loaded.</p><Button variant="outline" size="sm" onClick={() => { setFailed(false); onRefresh(); }}>Retry preview</Button></div>;
  return <img alt={name} src={url} onError={() => setFailed(true)} />;
}

