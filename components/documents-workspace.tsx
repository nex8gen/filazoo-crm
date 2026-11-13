"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { ArrowDown, ArrowUp, Clock3, FileText, FolderOpen, FolderPlus, LayoutGrid, List, Loader2, Plus, RefreshCw, Search, ShieldCheck, Star, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableFilter, TableFilters } from "@/components/ui/table-filters";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeaderDetails } from "@/components/page-header";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DocumentEditorState } from "@/components/document-editor";
import { documentSizeLabel } from "@/lib/document-connections";
import { DocumentLibraryNav } from "@/components/document-library-nav";
import { DocumentFileIcon } from "@/components/document-file-icon";
import type { DocumentUploadReporter } from "@/components/document-upload-dialog";
import { DocumentPreview } from "@/components/document-preview";
import { DocumentRowActions } from "@/components/document-row-actions";
import { DocumentTemplateCard } from "@/components/document-template-card";
import { useDocumentLibrary } from "@/components/use-document-library";
import { documentLibraryQueryKey } from "@/lib/document-library-state";
import { DOCUMENT_BUCKET, documentCategories, formatDocumentSize, isBuiltinEmailTemplate, type DocumentCategory, type LibraryDocument, type LibraryResult } from "@/lib/documents";
import { attachmentMimeType } from "@/lib/email-files";
import { createDocumentUploadSession, type UploadTicket } from "@/lib/document-upload";
import type { Product } from "@/lib/types";
import "./documents-workspace.css";

const DocumentEditor = dynamic(() => import("@/components/document-editor").then(module => module.DocumentEditor));
const DocumentAddDialog = dynamic(() => import("@/components/document-add-dialog").then(module => module.DocumentAddDialog));
const DocumentUploadDialog = dynamic(() => import("@/components/document-upload-dialog").then(module => module.DocumentUploadDialog));

const views = [{ id: "all", label: "All files", icon: FolderOpen }, { id: "recent", label: "Recently updated", icon: Clock3 }, { id: "starred", label: "Starred", icon: Star }, { id: "templates", label: "Email templates", icon: FileText }] as const;
const fileTypes = [{ id: "", label: "All types" }, { id: "pdf", label: "PDFs" }, { id: "document", label: "Documents" }, { id: "spreadsheet", label: "Spreadsheets" }, { id: "image", label: "Images" }];
function subscribeWide(change: () => void) { const media = window.matchMedia("(min-width: 1280px)"); media.addEventListener("change", change); return () => media.removeEventListener("change", change); }
function wideSnapshot() { return window.matchMedia("(min-width: 1280px)").matches; }
async function saveAction(value: Record<string, unknown>) {
  const response = await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Unable to save. Try again.");
  return result;
}
export function DocumentsWorkspace({ canWrite, workspaceName, initialCategory, initialData, products = [] }: { canWrite: boolean; workspaceName: string; initialCategory?: DocumentCategory; initialData?: LibraryResult; products?: Product[] }) {
  const router = useRouter();
  const wide = useSyncExternalStore(subscribeWide, wideSnapshot, () => false);
  const [view, setView] = useState(initialCategory === "promotion" || initialCategory === "everyday" ? "templates" : "all");
  const templatesOnly = view === "templates";
  const canUpload = canWrite && !templatesOnly;
  const [folderId, setFolderId] = useState<string | null>(null);
  const [category, setCategory] = useState<DocumentCategory | "">(initialCategory ?? "");
  const isEmailTemplateSection = templatesOnly && category !== "promotion";
  const [query, setQuery] = useState("");
  const [fileType, setFileType] = useState("");
  const [sort, setSort] = useState("newest");
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const displayLayout = templatesOnly ? "grid" : layout;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRelated, setSelectedRelated] = useState<{ key: string; document: LibraryDocument } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editor, setEditor] = useState<DocumentEditorState | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [trashTarget, setTrashTarget] = useState<LibraryDocument | null>(null);
  const [pending, setPending] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const uploadSession = useRef<ReturnType<typeof createDocumentUploadSession<File>> | null>(null);
  const queryKey = documentLibraryQueryKey({ view, folder: folderId, category, q: query, type: fileType, sort });
  const { data, metadata, loading, error, invalidate } = useDocumentLibrary(queryKey, offset, refresh, initialData);
  const folders = metadata?.folders ?? [];
  const stats = metadata?.stats;
  const selected = data?.documents.find(item => item.id === selectedId) ?? (selectedRelated?.key === queryKey && selectedRelated.document.id === selectedId ? selectedRelated.document : null);
  const activeFolder = folders.find(folder => folder.id === folderId);
  const title = activeFolder?.name ?? documentCategories.find(item => item.id === category)?.label ?? (view === "recent" ? "Recently updated" : view === "starred" ? "Starred" : view === "templates" ? "Email templates" : view === "trash" ? "Trash" : "All files");
  const hasFilters = !!query || !!fileType;

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key === "/" && !event.ctrlKey && !event.metaKey && !target.closest("input, textarea, select, [contenteditable], [role=dialog]")) { event.preventDefault(); searchInput.current?.focus(); }
      if (event.key === "Escape" && !editor && !trashTarget && !target.closest("[role=dialog]")) setSelectedId(null);
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [editor, trashTarget]);
  useEffect(() => {
    let lastRefresh = Date.now();
    const refresh = () => { if (Date.now() - lastRefresh < 30_000) return; lastRefresh = Date.now(); setRefresh(value => value + 1); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);
  function addDocument() { if (["quotation", "proforma", "invoice", "purchase_order", "payment"].includes(category)) setAdding(true); else setEditor({ mode: "upload" }); }
  function reload() { invalidate(); setOffset(0); setRefresh(value => value + 1); }
  function navigate(next: string, folder: string | null = null, category: DocumentCategory | "" = "") { setView(next); setFolderId(folder); setCategory(category); if (next === "templates") setFileType(""); setOffset(0); setSelectedId(null); setSelectedRelated(null); }
  async function editDocument(document: LibraryDocument) {
    if (!isBuiltinEmailTemplate(document)) { setEditor({ mode: "edit", document }); return; }
    try {
      const response = await fetch(`/api/documents/${document.id}?details=1`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to open the template.");
      const complete = result.document as LibraryDocument;
      setEditor({ mode: "template", initial: { name: complete.name + " (copy)", subject: complete.subject, body: complete.body, email_design: complete.email_design, category: "everyday" } });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to open the template."); }
  }
  function clearFilters() { setQuery(""); setFileType(""); setOffset(0); }
  function pickFiles(files: File[]) {
    if (files.length) setEditor({ mode: "upload", files });
  }
  async function saveEditor(value: Record<string, unknown>, files?: File[], report?: DocumentUploadReporter) {
    if (editor?.mode === "folder") { await saveAction({ ...value, action: "folder" }); toast.success("Folder created"); reload(); return; }
    if (files?.length) {
      const { createClient } = await import("@/lib/supabase/client");
      const client = createClient();
      uploadSession.current ??= createDocumentUploadSession<File>({
        prepare: async file => await saveAction({ action: "prepare_upload", size: file.size }) as UploadTicket,
        transfer: async (file, ticket) => {
          const result = await client.storage.from(DOCUMENT_BUCKET).uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: attachmentMimeType(file.name, file.type) });
          if (result.error) throw new Error(result.error.message);
        },
        save: (ticket, metadata) => saveAction({ ...metadata, action: "create", id: ticket.id, kind: "file" }),
      });
      const { file_names, ...metadata } = value;
      const failures: File[] = [];
      let next = 0;
      const worker = async () => { while (next < files.length) {
        const index = next++;
        const file = files[index];
        try {
          await uploadSession.current!(file, { ...metadata, name: Array.isArray(file_names) ? file_names[index] : files.length === 1 ? value.name : file.name }, stage => report?.(file, stage));
        } catch (cause) { failures.push(file); report?.(file, "error", cause instanceof Error ? cause.message : "Unable to save this file."); }
      } };
      await Promise.all([worker(), worker()]);
      reload();
      if (failures.length) throw new Error(`${failures.length} file${failures.length === 1 ? "" : "s"} could not be saved. Retry the failed files. Saved files will not be uploaded again.`);
      toast.success(`${files.length} file${files.length === 1 ? "" : "s"} added to your library`); return;
    }
    const document = editor?.document;
    const result = await saveAction({ ...value, action: value.action ?? (document ? "update" : "create"), id: value.id ?? document?.id ?? crypto.randomUUID(), kind: document?.kind ?? "template", updated_at: value.updated_at ?? document?.updated_at });
    toast.success(document ? "Details updated" : "Template saved in Custom emails"); if (!document) navigate("templates", null, "everyday"); reload();
    return result.document as LibraryDocument;
  }
  async function star(document: LibraryDocument) {
    try { await saveAction({ action: "star", id: document.id, starred: !document.starred }); reload(); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Unable to update starred files."); }
  }
  async function restore(document: LibraryDocument) {
    try { await saveAction({ action: "restore", id: document.id, updated_at: document.updated_at }); toast.success("Item restored"); setSelectedId(null); reload(); }
    catch (cause) { toast.error(cause instanceof Error ? cause.message : "Unable to restore this item."); }
  }
  function drop(event: DragEvent) { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (!editor && !adding && canUpload && event.dataTransfer.files.length) pickFiles(Array.from(event.dataTransfer.files)); }
  const previewProps = { document: selected, folders, canWrite, onSelectRelated: (document: LibraryDocument) => { setSelectedRelated({ key: queryKey, document }); setSelectedId(document.id); }, onUseInEmail: () => { if (selected) router.push(`/email?libraryItem=${selected.id}`); }, onClose: () => setSelectedId(null), onEdit: () => { if (selected) { editDocument(selected); if (!wide) setSelectedId(null); } }, onStar: () => { if (selected) void star(selected); }, onTrash: () => setTrashTarget(selected), onRestore: () => { if (selected) void restore(selected); } };
  return <div className="document-library" onDragEnter={event => { if (!editor && !adding && canUpload && event.dataTransfer.types.includes("Files")) { event.preventDefault(); dragDepth.current++; setDragging(true); } }} onDragOver={event => { if (!editor && canUpload && event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) { dragDepth.current = 0; setDragging(false); } }} onDrop={drop}>
    <PageHeaderDetails><span className="text-xs text-muted-foreground">{workspaceName} library</span></PageHeaderDetails>
    <div className={`library-layout ${wide && selected ? "has-preview" : ""}`}>
      <DocumentLibraryNav view={view} folderId={folderId} category={category} folders={folders} stats={stats} canWrite={canWrite && !error} onNavigate={navigate} onCreateFolder={() => setEditor({ mode: "folder" })} />
      <section className="library-main" aria-label={title}>
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 pt-5 pb-4 md:px-6">
          <div className="flex min-w-0 items-center gap-2"><h2 className="truncate text-base font-semibold">{title}</h2><span className="text-xs text-muted-foreground">{data?.total ?? ""}</span></div>
          <div role="group" aria-label="Section actions" className="ml-auto flex flex-wrap items-center justify-end gap-2 empty:hidden">
            {isEmailTemplateSection ? <Button size="sm" disabled={!canWrite || !!error} onClick={() => setEditor({ mode: "template" })}><Plus className="size-4" />New template</Button> : null}
            {!templatesOnly ? <Button size="sm" disabled={!canWrite || !!error} onClick={addDocument}><Upload className="size-4" />{category && ["quotation", "proforma", "invoice", "purchase_order", "payment"].includes(category) ? "Add document" : "Upload files"}</Button> : null}
          </div>
        </header>
        <div className="mb-4 flex shrink-0 gap-2 px-4 md:hidden">
          <Select value={folderId ?? (category ? `category:${category}` : view)} onValueChange={value => { if (!value) return; if (value.startsWith("category:")) { const next = documentCategories.find(item => item.id === value.slice(9))!; navigate(next.group === "Email templates" ? "templates" : "all", null, next.id); } else if (folders.some(folder => folder.id === value)) navigate("all", value); else navigate(value); }}>
            <SelectTrigger size="sm" aria-label="Library location" className="flex-1"><SelectValue /></SelectTrigger><SelectContent>
              {views.map(item => <SelectItem value={item.id} key={item.id}>{item.label}</SelectItem>)}
              {["Business documents", "Shared resources", "Email templates"].map(group => <SelectGroup key={group}><SelectLabel>{group}</SelectLabel>{documentCategories.filter(item => item.group === group).map(item => <SelectItem value={`category:${item.id}`} key={item.id}>{item.label}</SelectItem>)}</SelectGroup>)}
              <SelectGroup><SelectLabel>Folders</SelectLabel>{folders.map(folder => <SelectItem key={folder.id} value={folder.id}>{folder.name}</SelectItem>)}</SelectGroup><SelectItem value="trash">Trash</SelectItem>
            </SelectContent>
          </Select>
          {canWrite ? <Button size="sm" variant="outline" onClick={() => setEditor({ mode: "folder" })}><FolderPlus />New folder</Button> : null}
        </div>
        <div className="mb-4 shrink-0 px-4 md:px-6">
          <TableFilters actions={templatesOnly && category === "promotion" ? null : <>
            <Button type="button" variant="outline" size="icon-sm" aria-label="Refresh files" disabled={loading} onClick={reload}><RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /></Button>
            {!templatesOnly ? <><Button type="button" variant={layout === "list" ? "secondary" : "ghost"} size="icon-sm" aria-label="List view" aria-pressed={layout === "list"} onClick={() => setLayout("list")}><List className="size-4" /></Button>
            <Button type="button" variant={layout === "grid" ? "secondary" : "ghost"} size="icon-sm" aria-label="Grid view" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}><LayoutGrid className="size-4" /></Button></> : null}
          </>}>
            <TableFilter label="Search library" search><Input ref={searchInput} type="search" aria-label="Search library" value={query} onChange={event => { setQuery(event.target.value); setOffset(0); }} placeholder={templatesOnly ? "Search template names, subjects, or messages" : "Search files, companies, tags, or template text"} /></TableFilter>
              {!templatesOnly ? <TableFilter label="File type"><Select value={fileType || "all"} onValueChange={value => { setFileType(value === "all" ? "" : value ?? ""); setOffset(0); }}><SelectTrigger aria-label="File type"><SelectValue /></SelectTrigger><SelectContent>{fileTypes.map(type => <SelectItem key={type.id || "all"} value={type.id || "all"}>{type.label}</SelectItem>)}</SelectContent></Select></TableFilter> : null}
              <TableFilter label="Sort files"><Select value={sort} onValueChange={value => { setSort(value ?? "newest"); setOffset(0); }}><SelectTrigger aria-label="Sort files"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="newest">Newest first</SelectItem><SelectItem value="oldest">Oldest first</SelectItem><SelectItem value="name">Name A-Z</SelectItem></SelectContent></Select></TableFilter>
            {hasFilters ? <Button type="button" size="sm" variant="ghost" onClick={clearFilters}><X className="size-4" />Clear filters</Button> : null}
          </TableFilters>
        </div>
        {templatesOnly && category && category !== "promotion" ? <p className="mb-3 shrink-0 px-4 text-xs text-muted-foreground md:px-6">Email templates created by members of this workspace.</p> : null}
        {view === "recent" ? <p className="mb-3 flex shrink-0 items-center gap-2 px-4 text-xs text-muted-foreground md:px-6"><Clock3 className="size-3.5" />Files updated in the last 30 days.</p> : view === "trash" ? <p className="mb-3 flex shrink-0 items-center gap-2 px-4 text-xs text-muted-foreground md:px-6"><Trash2 className="size-3.5" />Items stay here until you restore them.</p> : null}
        {error ? <NotificationToast><ShieldCheck /><h4>Unable to load files</h4><p>{error}</p><Button variant="outline" onClick={reload}><RefreshCw />Try again</Button></NotificationToast> : loading && !data ? <div className="library-skeleton" role="status" aria-label="Loading files">{[0, 1, 2, 3, 4].map(index => <div key={index} />)}</div> : !data?.documents.length ? <div className="library-empty"><div className="library-empty-icon">{hasFilters ? <Search /> : view === "starred" ? <Star /> : view === "trash" ? <Trash2 /> : view === "templates" ? <FileText /> : <FolderOpen />}</div><h4>{hasFilters ? "No matching files" : view === "starred" ? "No starred files" : view === "trash" ? "Trash is empty" : view === "templates" ? "No templates yet" : "No files yet"}</h4><p>{hasFilters ? "Try another keyword or clear the search filters." : view === "starred" ? "Star files or templates to find them here." : view === "trash" ? "Items moved to trash can be restored here." : view === "templates" ? isEmailTemplateSection ? "Create a reusable message and link the files you usually send with it." : category === "promotion" ? "Prebuilt templates are available to every workspace." : "Create a reusable message in Custom emails or browse the prebuilt Email library." : ["quotation", "proforma", "invoice", "purchase_order", "payment"].includes(category) ? "Create from CRM records or upload a file linked to the right customer, products, or order." : "Upload files to this category, then add a customer name or tags to find them quickly."}</p>{hasFilters ? <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button> : canWrite && (view === "all" || isEmailTemplateSection) ? <Button size="sm" onClick={() => view === "templates" ? setEditor({ mode: "template" }) : addDocument()}>{view === "templates" ? <Plus /> : <Upload />}{view === "templates" ? "Create template" : ["quotation", "proforma", "invoice", "purchase_order", "payment"].includes(category) ? "Add document" : "Upload files"}</Button> : null}<span className="library-empty-footnote">{view === "all" && !hasFilters ? "Drag and drop files here · Up to 50 MB per file" : null}</span></div> : <div className={templatesOnly ? "library-template-grid" : displayLayout === "grid" ? "library-document-grid" : "library-file-table"} aria-busy={loading}>
          {displayLayout === "list" ? <Table aria-label={title} className="min-w-[560px]">
            <TableHeader><TableRow>
              <TableHead aria-sort={sort === "name" ? "ascending" : undefined}><span className="inline-flex items-center gap-1">Name{sort === "name" ? <ArrowDown className="size-3.5" /> : null}</span></TableHead>
              <TableHead className="hidden md:table-cell">Company</TableHead>
              <TableHead>{templatesOnly ? "Subject" : "Details"}</TableHead>
              <TableHead aria-sort={sort === "name" ? undefined : sort === "oldest" ? "ascending" : "descending"}><button type="button" className="inline-flex items-center gap-1" onClick={() => { setSort(sort === "oldest" ? "newest" : "oldest"); setOffset(0); }} aria-label={sort === "oldest" ? "Sort newest first" : "Sort oldest first"}>Updated{sort === "name" ? null : sort === "oldest" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />}</button></TableHead>
              <TableHead className="w-20"><span className="sr-only">Actions</span></TableHead>
            </TableRow></TableHeader>
            <TableBody>{data.documents.map(document => <TableRow key={document.id} data-state={selectedId === document.id ? "selected" : undefined} onClick={() => setSelectedId(document.id)} className="cursor-pointer">
              <TableCell><button type="button" className="flex max-w-96 items-center gap-2 text-left font-medium" aria-label={`Preview ${document.name}`} aria-pressed={selectedId === document.id} onClick={() => setSelectedId(document.id)}><DocumentFileIcon document={document} size={20} /><span className="truncate" title={document.name}>{document.name}</span></button></TableCell>
              <TableCell className="hidden md:table-cell"><span className="block max-w-64 truncate" title={document.company}>{document.company || <span className="text-muted-foreground">Workspace</span>}</span></TableCell>
              <TableCell className="text-muted-foreground">{templatesOnly ? <span className="block max-w-80 truncate" title={document.subject}>{document.subject || "No subject"}</span> : document.kind === "template" ? "Email template" : documentSizeLabel(document) || formatDocumentSize(document.size)}</TableCell>
              <TableCell className="text-muted-foreground">{new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "Asia/Shanghai" }).format(new Date(document.updated_at))}</TableCell>
              <TableCell onClick={event => event.stopPropagation()}><div className="flex items-center justify-end gap-1">{!isBuiltinEmailTemplate(document) ? <button type="button" className={`library-star ${document.starred ? "is-starred" : ""}`} aria-label={`${document.starred ? "Unstar" : "Star"} ${document.name}`} aria-pressed={document.starred} onClick={() => void star(document)}><Star /></button> : null}<DocumentRowActions document={document} canWrite={canWrite} onEmail={() => router.push(`/email?libraryItem=${document.id}&libraryRequest=${crypto.randomUUID()}`)} onEdit={() => editDocument(document)} onTrash={() => setTrashTarget(document)} onRestore={() => void restore(document)} /></div></TableCell>
            </TableRow>)}</TableBody>
          </Table> : templatesOnly ? data.documents.map(document => <DocumentTemplateCard key={`${document.id}:${document.updated_at}`} document={document} workspaceName={workspaceName} selected={selectedId === document.id} onPreview={() => setSelectedId(document.id)} onStar={() => void star(document)}><DocumentRowActions document={document} canWrite={canWrite} onEmail={() => router.push(`/email?libraryItem=${document.id}&libraryRequest=${crypto.randomUUID()}`)} onEdit={() => editDocument(document)} onTrash={() => setTrashTarget(document)} onRestore={() => void restore(document)} /></DocumentTemplateCard>) : data.documents.map(document => <div key={document.id} className={`library-file-row ${selectedId === document.id ? "is-selected" : ""}`}><button type="button" className="library-file-select" aria-label={`Preview ${document.name}`} aria-pressed={selectedId === document.id} onClick={() => setSelectedId(document.id)}><DocumentFileIcon document={document} /><span className="library-file-name"><strong>{document.name}</strong><small>{layout === "grid" && document.folder_id ? folders.find(folder => folder.id === document.folder_id)?.name + " · " : ""}{document.kind === "template" ? "Email template" : documentSizeLabel(document) || formatDocumentSize(document.size)}{document.tags.length ? <span className="library-row-tag">{document.tags[0]}</span> : null}</small></span><span className="library-company">{document.company || <span className="text-muted-foreground/60">Workspace</span>}</span><span className="library-updated">{new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "Asia/Shanghai" }).format(new Date(document.updated_at))}</span></button>{!isBuiltinEmailTemplate(document) ? <button type="button" className={`library-star ${document.starred ? "is-starred" : ""}`} aria-label={`${document.starred ? "Unstar" : "Star"} ${document.name}`} aria-pressed={document.starred} onClick={() => void star(document)}><Star /></button> : null}<DocumentRowActions document={document} canWrite={canWrite} onEmail={() => router.push(`/email?libraryItem=${document.id}&libraryRequest=${crypto.randomUUID()}`)} onEdit={() => editDocument(document)} onTrash={() => setTrashTarget(document)} onRestore={() => void restore(document)} /></div>)}
          {data.documents.length < data.total ? <div className="library-load-more"><Button variant="outline" size="sm" disabled={loading} onClick={() => setOffset(data.documents.length)}>Load more</Button></div> : null}
        </div>}
      </section>
      {wide && selected ? <aside className="library-preview-desktop" aria-label="File details"><DocumentPreview key={selectedId} {...previewProps} /></aside> : null}
    </div>
    {!wide ? <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelectedId(null); }}><DialogContent className="library-mobile-preview-dialog sm:max-w-lg" showCloseButton={false}><DialogHeader className="sr-only"><DialogTitle>File preview</DialogTitle><DialogDescription>Preview and manage the selected file.</DialogDescription></DialogHeader><DocumentPreview key={selectedId} {...previewProps} /></DialogContent></Dialog> : null}
    {dragging ? <div className="library-drop-overlay"><Upload /><h3>Drop your files here</h3><p>We’ll help you organize them next.</p><span>Up to 20 files · 50 MB each</span></div> : null}
    {adding ? <DocumentAddDialog category={category || "general"} onClose={() => setAdding(false)} onUpload={() => { setAdding(false); setEditor({ mode: "upload" }); }} onCreated={reload} /> : null}
    {editor?.mode === "upload" ? <DocumentUploadDialog initialFiles={editor.files} folders={folders} folderId={folderId} category={category || undefined} onClose={() => setEditor(null)} onSave={async (value, files, report) => { await saveEditor(value, files, report); }} /> : editor ? <DocumentEditor key={`${editor.mode}-${editor.document?.id ?? "new"}`} editor={editor} products={products} folders={folders} folderId={folderId} category={category || undefined} onClose={() => setEditor(null)} onSave={saveEditor} /> : null}
    <Dialog open={!!trashTarget} onOpenChange={open => { if (!open && !pending) setTrashTarget(null); }}><DialogContent><DialogHeader><DialogTitle>Move to trash?</DialogTitle><DialogDescription>“{trashTarget?.name}” will be hidden from your library. You can restore it from Trash at any time.</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" disabled={pending} onClick={() => setTrashTarget(null)}>Cancel</Button><Button variant="destructive" disabled={pending} onClick={async () => { if (!trashTarget) return; setPending(true); try { await saveAction({ action: "trash", id: trashTarget.id, updated_at: trashTarget.updated_at }); setTrashTarget(null); setSelectedId(null); reload(); toast.success("Moved to trash"); } catch (cause) { toast.error(cause instanceof Error ? cause.message : "Unable to move this item."); } finally { setPending(false); } }}>{pending ? <Loader2 className="animate-spin" /> : <Trash2 />}Move to trash</Button></div></DialogContent></Dialog>
  </div>;
}
