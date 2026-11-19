import "server-only";
import { getWorkspaceViewer, type WorkspaceViewer } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { currentWorkspaceContext, withWorkspaceViewer } from "../workspace-context.ts";
import { DOCUMENT_BUCKET, escapeDocumentSearch } from "../documents.ts";
import { DocumentError } from "./documents.ts";
import { isProductVideo, PRODUCT_LIBRARY_MEDIA_TYPES, productLibraryMediaPattern, productLibraryMediaUrl, type ProductMediaPage } from "../product-media.ts";

const mediaFields = "id,name,mime_type,size,created_at,object_path";
type MediaViewer = Pick<WorkspaceViewer, "id" | "workspaceId">;
function mediaQuery(viewer: MediaViewer) {
  return createSupabaseAdmin().from("library_documents").select(mediaFields, { count: "exact" })
    .eq("workspace_id", viewer.workspaceId).eq("kind", "file").is("deleted_at", null).is("source_type", null)
    .in("mime_type", Object.keys(PRODUCT_LIBRARY_MEDIA_TYPES));
}

export async function listProductMedia(viewer: WorkspaceViewer, params: URLSearchParams): Promise<ProductMediaPage> {
  return withWorkspaceViewer(viewer, async () => {
    let query = mediaQuery(viewer);
    const search = params.get("q")?.trim().slice(0, 200);
    if (search) query = query.ilike("search_text", `%${escapeDocumentSearch(search.toLowerCase())}%`);
    const type = params.get("type");
    if (type === "image" || type === "video") query = query.like("mime_type", `${type}/%`);
    const size = params.get("size");
    if (size === "small") query = query.lt("size", 1024 * 1024);
    if (size === "medium") query = query.gte("size", 1024 * 1024).lte("size", 10 * 1024 * 1024);
    if (size === "large") query = query.gt("size", 10 * 1024 * 1024);
    const sort = params.get("sort"), offset = Math.max(0, Math.min(100_000, Number(params.get("offset")) || 0));
    const result = await query.order(sort === "name" ? "name" : "created_at", { ascending: sort === "name" || sort === "oldest" }).order("id").range(Math.floor(offset), Math.floor(offset) + 47);
    if (result.error) throw new DocumentError("Could not load company media. Please try again.", 503);
    return { items: (result.data ?? []).map(row => ({ id: row.id, name: row.name, mimeType: row.mime_type, size: row.size, createdAt: row.created_at, url: productLibraryMediaUrl(row.id, row.mime_type)! })), total: result.count ?? 0, canUpload: viewer.role !== "viewer" };
  });
}

/** Resolve every reference through current workspace membership, never a saved signed URL. */
export async function validateProductMediaReferences(viewer: WorkspaceViewer, urls: (string | null | undefined)[]) {
  const references = [...new Set(urls.filter((url): url is string => Boolean(url && productLibraryMediaPattern.test(url))))];
  if (!references.length) return null;
  return withWorkspaceViewer(viewer, async () => {
    const result = await mediaQuery(viewer).in("id", references.map(url => productLibraryMediaPattern.exec(url)![1]));
    if (result.error) return "Could not verify company media. Please try again.";
    const allowed = new Set((result.data ?? []).map(row => productLibraryMediaUrl(row.id, row.mime_type)));
    return references.every(url => allowed.has(url)) ? null : "Some selected media is unavailable in this company library. Remove it and choose another file.";
  });
}

export async function productMediaDownload(viewer: WorkspaceViewer, url: string) {
  const match = productLibraryMediaPattern.exec(url);
  if (!match) throw new DocumentError("Choose a valid media file.", 404);
  return withWorkspaceViewer(viewer, async () => {
    const result = await mediaQuery(viewer).eq("id", match[1]).maybeSingle();
    if (result.error) throw new DocumentError("Could not open this media file.", 503);
    const row = result.data;
    if (!row || productLibraryMediaUrl(row.id, row.mime_type) !== url || row.object_path !== `${viewer.workspaceId}/${row.id}`) throw new DocumentError("This media file is unavailable.", 404);
    const signed = await createSupabaseAdmin().storage.from(DOCUMENT_BUCKET).createSignedUrl(row.object_path, 300);
    if (signed.error || !signed.data) throw new DocumentError("Could not open this media file.", 503);
    return signed.data.signedUrl;
  });
}

/** PDF and email renderers use the same workspace check as the media picker. */
export async function readProductLibraryImage(url: string, viewerId?: string) {
  const match = productLibraryMediaPattern.exec(url);
  if (!match || isProductVideo(url)) throw new DocumentError("Choose an image from company storage.");
  const scope = currentWorkspaceContext();
  const viewer = scope && scope.workspaceId !== "legacy" ? { workspaceId: scope.workspaceId, id: scope.userId ?? viewerId ?? "" } : await getWorkspaceViewer();
  if (!viewer || (viewerId && viewer.id !== viewerId)) throw new DocumentError("This media file is unavailable.", 404);
  return withWorkspaceViewer(viewer, async () => {
    const row = await mediaQuery(viewer).eq("id", match[1]).maybeSingle();
    if (row.error || !row.data || row.data.size > 10_000_000 || productLibraryMediaUrl(row.data.id, row.data.mime_type) !== url || row.data.object_path !== `${viewer.workspaceId}/${row.data.id}`) throw new DocumentError("This image is unavailable or too large for export.", 404);
    const file = await createSupabaseAdmin().storage.from(DOCUMENT_BUCKET).download(row.data.object_path);
    if (file.error || !file.data) throw new DocumentError("Could not load this image.", 503);
    return file.data;
  });
}
