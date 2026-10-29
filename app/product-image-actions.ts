"use server";

import { randomUUID } from "node:crypto";
import { requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { MAX_PRODUCT_IMAGE_SIZE, PRODUCT_IMAGE_BUCKET, PRODUCT_IMAGE_TYPES, productImageError } from "@/lib/product-images";

export async function prepareProductImageUpload(type: string, size: number) {
  const viewer = await requireWorkspaceMember();
  const validationError = productImageError(type, size);
  if (validationError) return { error: validationError };

  const supabase = createSupabaseAdmin();
  const { data: bucket } = await supabase.storage.getBucket(PRODUCT_IMAGE_BUCKET);
  if (!bucket) {
    const { error } = await supabase.storage.createBucket(PRODUCT_IMAGE_BUCKET, {
      public: false,
      fileSizeLimit: MAX_PRODUCT_IMAGE_SIZE,
      allowedMimeTypes: PRODUCT_IMAGE_TYPES,
    });
    // Another upload may have created the bucket concurrently.
    if (error && !(await supabase.storage.getBucket(PRODUCT_IMAGE_BUCKET)).data) {
      return { error: "Image storage could not be prepared. Please try again." };
    }
  }
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[type];
  const path = `${viewer.id}/${randomUUID()}.${extension}`;
  const { data, error } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) return { error: "Could not start the image upload. Please try again." };
  return { path, token: data.token, imageUrl: `/api/product-images/${path}` };
}
