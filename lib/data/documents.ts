import "server-only";
import type { WorkspaceViewer } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { withWorkspaceViewer } from "../workspace-context.ts";
import { DOCUMENT_BUCKET, MAX_DOCUMENT_BYTES, documentInputSchema, documentSearchText, escapeDocumentSearch, folderInputSchema, type LibraryDocument, type LibraryFolder, type LibraryResult } from "../documents.ts";
import { z } from "zod";
import { validateDocumentConnections } from "./document-connections.ts";
import { filterDocumentLibrary } from "../document-library-filter.ts";
import { isSameDocumentUpload } from "../document-upload.ts";
import { emailDesignText } from "../email-design.ts";

/** Bound both row count and payload size so large libraries keep server pagination. */
export async function bootstrapDocumentLibrary(viewer: WorkspaceViewer, params: URLSearchParams): Promise<LibraryResult> {
  const collection = await withWorkspaceViewer(viewer, async () => {
    const db = createSupabaseAdmin();
    const [rows, folders, stars] = await Promise.all([
      db.from("library_documents").select(`${fields},search_text`, { count: "exact" }).or(visibility(viewer)).order("id").range(0, 299),
      db.from("document_folders").select("id,name,color").order("name"),
      db.from("document_stars").select("document_id").eq("user_id", viewer.id),
    ]);
    [rows, folders, stars].forEach(result => check(result.error));
    if (rows.count === null || rows.count !== rows.data?.length || Buffer.byteLength(JSON.stringify(rows.data)) > 1_000_000) return null;
    const starred = new Set((stars.data ?? []).map(row => row.document_id));
    const documents = (rows.data ?? []).map(row => ({ ...row, starred: starred.has(row.id) })) as LibraryDocument[];
    const active = documents.filter(item => !item.deleted_at);
    return { documents, folders: folders.data as LibraryFolder[], stats: { files: active.filter(item => item.kind === "file").length, templates: active.filter(item => item.kind === "template").length, starred: active.filter(item => item.starred).length, trash: documents.length - active.length } };
  });
  if (!collection) return { ...await listDocuments(viewer, params), collection: null };
  return { ...filterDocumentLibrary(collection, params, Number(params.get("offset")) || 0), collection };
}

const fields = "id,name,kind,mime_type,size,folder_id,company,tags,description,subject,body,created_at,updated_at,deleted_at,category,related_ids,source_type,source_id,source_status,company_id,purchase_order_id,invoice_id,product_skus,created_by,design_version:email_design->>version";
const visibility = (viewer: WorkspaceViewer) => `source_type.is.null,source_type.neq.quotation,created_by.eq.${viewer.id}`;
export class DocumentError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
function check(error: unknown) {
  if (error) throw new DocumentError("The file library is temporarily unavailable. Please try again.", 503);
}
function writer(viewer: WorkspaceViewer) {
  if (viewer.role === "viewer") throw new DocumentError("Your role has read-only access to this library.", 403);
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new DocumentError(result.error.issues[0]?.message ?? "Check the item details.");
  return result.data;
}
async function folderExists(db: ReturnType<typeof createSupabaseAdmin>, id: string | null) {
  if (!id) return;
  const result = await db.from("document_folders").select("id").eq("id", id).maybeSingle();
  check(result.error);
  if (!result.data) throw new DocumentError("This folder is unavailable. Choose another folder.", 404);
}
export async function listDocuments(viewer: WorkspaceViewer, params: URLSearchParams): Promise<LibraryResult> {
  return withWorkspaceViewer(viewer, async () => {
    const db = createSupabaseAdmin();
    const [folders, stars, files, templates, trash] = await Promise.all([
      db.from("document_folders").select("id,name,color").order("name"),
      db.from("document_stars").select("document_id").eq("user_id", viewer.id),
      db.from("library_documents").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("kind", "file").or(visibility(viewer)),
      db.from("library_documents").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("kind", "template"),
      db.from("library_documents").select("id", { count: "exact", head: true }).not("deleted_at", "is", null).or(visibility(viewer)),
    ]);
    [folders, stars, files, templates, trash].forEach(result => check(result.error));
    const starIds = new Set<string>((stars.data ?? []).map(row => row.document_id));
    let query = db.from("library_documents").select(fields, { count: "exact" }).or(visibility(viewer));
    if (params.get("attachable") === "1") query = query.neq("mime_type", "application/x-filazoo-record");
    const view = params.get("view");
    const kind = params.get("kind");
    if (kind === "file" || kind === "template") query = query.eq("kind", kind);
    query = view === "trash" ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
    if (view === "templates") query = query.eq("kind", "template");
    const category = params.get("category");
    if (category) query = query.eq("category", category);
    const company = params.get("company")?.trim().slice(0, 160);
    if (company) query = query.ilike("company", `%${escapeDocumentSearch(company)}%`);
    if (view === "starred") query = query.in("id", [...starIds]);
    if (view === "recent") query = query.gte("updated_at", new Date(Date.now() - 30 * 86400000).toISOString());
    const after = params.get("after"), before = params.get("before");
    if (after && z.iso.date().safeParse(after).success) query = query.gte("updated_at", `${after}T00:00:00+08:00`);
    if (before && z.iso.date().safeParse(before).success) query = query.lt("updated_at", new Date(Date.parse(`${before}T00:00:00+08:00`) + 86400000).toISOString());
    const folder = params.get("folder");
    if (folder && z.uuid().safeParse(folder).success) query = query.eq("folder_id", folder);
    const search = params.get("q")?.trim().slice(0, 200);
    if (search) query = query.ilike("search_text", `%${escapeDocumentSearch(search.toLowerCase())}%`);
    const type = params.get("type");
    if (type === "pdf") query = query.eq("mime_type", "application/pdf");
    if (type === "image") query = query.like("mime_type", "image/%");
    if (type === "spreadsheet") query = query.in("mime_type", ["text/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.oasis.opendocument.spreadsheet"]);
    if (type === "document") query = query.in("mime_type", ["application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain", "text/markdown", "application/rtf"]);
    const order = params.get("sort");
    query = order === "name" ? query.order("name").order("id") : order === "oldest" ? query.order("updated_at").order("id") : query.order("updated_at", { ascending: false }).order("id");
    const offset = Math.max(0, Math.min(100000, Number(params.get("offset")) || 0));
    const result = await query.range(offset, offset + 59);
    check(result.error);
    const activeStars = starIds.size ? await db.from("library_documents").select("id", { count: "exact", head: true }).in("id", [...starIds]).is("deleted_at", null).or(visibility(viewer)) : { count: 0, error: null };
    check(activeStars.error);
    return { documents: (result.data ?? []).map(row => ({ ...row, starred: starIds.has(row.id) })) as LibraryDocument[], folders: folders.data as LibraryFolder[], total: result.count ?? 0, stats: { files: files.count ?? 0, templates: templates.count ?? 0, starred: activeStars.count ?? 0, trash: trash.count ?? 0 } };
  });
}

export async function mutateDocument(viewer: WorkspaceViewer, value: unknown) {
  const envelope = parse(z.object({ action: z.enum(["prepare_upload", "create", "update", "folder", "star", "trash", "restore"]) }).passthrough(), value);
  if (envelope.action !== "star") writer(viewer);
  return withWorkspaceViewer(viewer, async () => {
    const db = createSupabaseAdmin();
    if (envelope.action === "folder") {
      const input = parse(folderInputSchema, envelope);
      const result = await db.from("document_folders").insert({ ...input, created_by: viewer.id }).select("id,name,color").single();
      if (result.error?.code === "23505") throw new DocumentError("A folder with this name already exists.", 409);
      check(result.error); return { folder: result.data };
    }
    if (envelope.action === "prepare_upload") {
      const input = parse(z.object({ size: z.number().int().min(1).max(MAX_DOCUMENT_BYTES) }), envelope);
      void input;
      const id = crypto.randomUUID();
      // Opaque workspace/id paths never include user-supplied filenames.
      const path = `${viewer.workspaceId}/${id}`;
      const result = await db.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(path);
      check(result.error); return { id, path, token: result.data!.token };
    }
    if (envelope.action === "create") {
      const parsed = parse(documentInputSchema, envelope);
      let connections = {};
      if (parsed.kind === "file") {
        try { connections = await validateDocumentConnections(db, parsed.category, parsed); }
        catch (error) { throw new DocumentError(error instanceof Error ? error.message : "Check related records."); }
      }
      const input = { ...parsed, ...connections };
      await folderExists(db, input.folder_id);
      await validateRelated(db, input.related_ids, viewer);
      let mime_type = "text/plain", size = 0, object_path: string | null = null;
      if (input.kind === "file") {
        object_path = `${viewer.workspaceId}/${input.id}`;
        const info = await db.storage.from(DOCUMENT_BUCKET).info(object_path);
        if (info.error || !info.data) throw new DocumentError("The upload has not finished. Please upload the file again.");
        size = info.data.size ?? 0;
        mime_type = info.data.contentType || "application/octet-stream";
        if (size < 1 || size > MAX_DOCUMENT_BYTES) throw new DocumentError("Files must be between 1 byte and 50 MB.");
      }
      const row = { ...input, body: input.kind === "template" ? input.email_design ? emailDesignText(input.email_design) : input.body : "", subject: input.kind === "template" ? input.subject : "", mime_type, size, object_path, created_by: viewer.id };
      const result = await db.from("library_documents").insert({ ...row, search_text: documentSearchText(row) }).select(`${fields},email_design`).single();
      if (result.error?.code === "23505") {
        const existing = await db.from("library_documents").select(`${fields},object_path`).eq("id", input.id).eq("created_by", viewer.id).maybeSingle();
        check(existing.error);
        if (existing.data && isSameDocumentUpload(existing.data, row)) return { document: { ...existing.data, starred: false } };
        throw new DocumentError("This file was already saved with different details. Refresh the library before editing it.", 409);
      }
      check(result.error); return { document: { ...result.data, starred: false } };
    }
    const input = parse(z.object({ id: z.uuid() }), envelope);
    const existing = await db.from("library_documents").select(`${fields},object_path,email_design`).eq("id", input.id).or(visibility(viewer)).maybeSingle();
    check(existing.error);
    if (!existing.data) throw new DocumentError("This item is no longer available.", 404);
    if (envelope.action === "star") {
      const star = parse(z.object({ starred: z.boolean() }), envelope);
      const result = star.starred ? await db.from("document_stars").upsert({ document_id: input.id, user_id: viewer.id }, { onConflict: "workspace_id,document_id,user_id" }) : await db.from("document_stars").delete().eq("document_id", input.id).eq("user_id", viewer.id);
      check(result.error); return { ok: true };
    }
    if (existing.data.source_type) throw new DocumentError("This is a live CRM document. Open its source record to edit or remove it.", 409);
    const version = parse(z.object({ updated_at: z.iso.datetime({ offset: true }) }), envelope);
    let patch: Record<string, unknown>;
    if (envelope.action === "update") {
      if (existing.data.deleted_at) throw new DocumentError("Restore this item before editing it.", 409);
      const parsed = parse(documentInputSchema, { ...envelope, kind: existing.data.kind });
      let connections = {};
      if (parsed.kind === "file") {
        try { connections = await validateDocumentConnections(db, parsed.category, parsed); }
        catch (error) { throw new DocumentError(error instanceof Error ? error.message : "Check related records."); }
      }
      const next = { ...parsed, ...connections };
      await folderExists(db, next.folder_id);
      await validateRelated(db, next.related_ids, viewer);
      patch = { name: next.name, folder_id: next.folder_id, company: next.company, tags: next.tags, description: next.description, subject: next.kind === "template" ? next.subject : "", body: next.kind === "template" ? next.body : "", category: next.category, related_ids: next.related_ids, company_id: next.company_id, purchase_order_id: next.purchase_order_id, invoice_id: next.invoice_id, product_skus: next.product_skus };
      if (next.kind === "template") { patch.email_design = next.email_design !== undefined ? next.email_design : next.body !== existing.data.body ? null : existing.data.email_design; if (next.email_design) patch.body = emailDesignText(next.email_design); }
      patch.search_text = documentSearchText(patch as Parameters<typeof documentSearchText>[0]);
    } else patch = { deleted_at: envelope.action === "trash" ? new Date().toISOString() : null };
    const result = await db.from("library_documents").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", input.id).eq("updated_at", version.updated_at).select(`${fields},email_design`).maybeSingle();
    check(result.error);
    if (!result.data) throw new DocumentError("This item changed in another session. Refresh before trying again.", 409);
    return { document: result.data };
  });
}

async function validateRelated(db: ReturnType<typeof createSupabaseAdmin>, ids: string[], viewer: WorkspaceViewer) {
  if (!ids.length) return;
  const result = await db.from("library_documents").select("id").in("id", ids).eq("kind", "file").neq("mime_type", "application/x-filazoo-record").is("deleted_at", null).or(visibility(viewer));
  check(result.error);
  if (result.data?.length !== new Set(ids).size) throw new DocumentError("One of the related files is unavailable. Choose active files from this workspace.");
}

export async function getLibraryDocument(viewer: WorkspaceViewer, id: string) {
  if (!z.uuid().safeParse(id).success) throw new DocumentError("Choose a valid file.");
  return withWorkspaceViewer(viewer, async () => {
    const db = createSupabaseAdmin();
    const result = await db.from("library_documents").select(`${fields},email_design`).eq("id", id).is("deleted_at", null).or(visibility(viewer)).maybeSingle();
    check(result.error);
    if (!result.data) throw new DocumentError("This item is no longer available.", 404);
    const related = result.data.related_ids.length ? await db.from("library_documents").select(fields).in("id", result.data.related_ids).is("deleted_at", null).or(visibility(viewer)) : { data: [], error: null };
    check(related.error);
    if (related.data?.length !== result.data.related_ids.length) throw new DocumentError("A linked attachment is unavailable to your account. Edit the template to review its linked files.", 409);
    return { document: { ...result.data, starred: false } as LibraryDocument, related: (related.data ?? []).map(item => ({ ...item, starred: false })) as LibraryDocument[] };
  });
}

export async function documentDownload(viewer: WorkspaceViewer, id: string, download: boolean) {
  if (!z.uuid().safeParse(id).success) throw new DocumentError("Choose a valid file.");
  return withWorkspaceViewer(viewer, async () => {
    const db = createSupabaseAdmin();
    const result = await db.from("library_documents").select("object_path,name,deleted_at,kind,source_type,source_id").eq("id", id).or(visibility(viewer)).maybeSingle();
    check(result.error);
    if (!result.data || result.data.deleted_at || result.data.kind !== "file") throw new DocumentError("This file is unavailable. Restore it if it is in trash.", 404);
    if (result.data.source_type === "invoice") return { url: `/api/invoices/${result.data.source_id}/pdf${download ? "" : "?inline=1"}` };
    if (result.data.source_type === "quotation") {
      const quote = await db.from("catalogs").select("quote_document").eq("id", result.data.source_id).eq("user_id", viewer.id).maybeSingle();
      check(quote.error);
      if (!quote.data) throw new DocumentError("This quotation is unavailable.", 404);
      return { url: `/api/catalogs/${result.data.source_id}${quote.data.quote_document ? "/quotation" : ""}/pdf${download ? "?download=1" : ""}` };
    }
    if (result.data.source_type) throw new DocumentError("Open the source record to review this order or payment.", 415);
    const signed = await db.storage.from(DOCUMENT_BUCKET).createSignedUrl(result.data.object_path, 120, download ? { download: result.data.name } : {});
    check(signed.error); return { url: signed.data!.signedUrl };
  });
}
