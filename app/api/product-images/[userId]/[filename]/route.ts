import { getWorkspaceViewer } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { privateProductImagePattern, PRODUCT_IMAGE_BUCKET } from "@/lib/product-images";

export async function GET(_request: Request, context: { params: Promise<{ userId: string; filename: string }> }) {
  const viewer = await getWorkspaceViewer();
  if (!viewer) return new Response(null, { status: 401 });
  const { userId, filename } = await context.params;
  if (userId !== viewer.id || !privateProductImagePattern.test(`/api/product-images/${userId}/${filename}`)) return new Response(null, { status: 404 });
  const { data, error } = await createSupabaseAdmin().storage.from(PRODUCT_IMAGE_BUCKET).download(`${userId}/${filename}`);
  if (error || !data) return new Response(null, { status: 404 });
  return new Response(data, { headers: { "Content-Type": data.type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
