"use client";

import Image from "next/image";
import { useState } from "react";
import { prepareProductImageUpload } from "@/app/product-image-actions";
import { PRODUCT_IMAGE_BUCKET, PRODUCT_IMAGE_TYPES, productImageError } from "@/lib/product-images";
import { createClient } from "@/lib/supabase/client";
import type { DataMode } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ProductImagePicker({ id, label, value, onChange, disabled, mode, onBusyChange }: {
  id: string; label: string; value: string | null; onChange: (value: string | null) => void;
  disabled: boolean; mode: DataMode; onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function select(file: File) {
    setError("");
    const validationError = productImageError(file.type, file.size);
    if (validationError) { setError(validationError); return; }
    setBusy(true);
    onBusyChange(true);
    try {
      // Decode before uploading so corrupt files do not replace the current image.
      const bitmap = await createImageBitmap(file);
      bitmap.close();
      if (mode === "demo") {
        const image = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error("Could not read this image."));
          reader.readAsDataURL(file);
        });
        onChange(image);
      } else {
        const result = await prepareProductImageUpload(file.type, file.size);
        if (result.error || !result.token || !result.path || !result.imageUrl) throw new Error(result.error || "Could not start the upload.");
        const { error: uploadError } = await createClient().storage.from(PRODUCT_IMAGE_BUCKET)
          .uploadToSignedUrl(result.path, result.token, file, { contentType: file.type });
        if (uploadError) throw new Error("Image upload failed. Please try again.");
        onChange(result.imageUrl);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not upload this image. Please try again.");
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  return <div className="space-y-2">
    <Label htmlFor={id}>{label}</Label>
    <div className="flex flex-wrap items-center gap-3">
      {value ? <Image src={value} alt={label} width={64} height={64} unoptimized className="size-16 rounded-md border object-contain" /> : null}
      <div className="min-w-0 flex-1 space-y-1">
        <Input id={id} type="file" accept={PRODUCT_IMAGE_TYPES.join(",")} disabled={disabled || busy}
          aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
          onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void select(file); }} />
        <p id={`${id}-help`} className="text-xs text-muted-foreground" role="status">{busy ? "Uploading image…" : "Choose an image from your computer. JPG, PNG, WebP, or GIF, up to 5 MB."}</p>
      </div>
      {value && !disabled ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { onChange(null); setError(""); }}>Remove image</Button> : null}
    </div>
    {error ? <p id={`${id}-error`} role="alert" className="text-xs text-destructive">{error}</p> : null}
  </div>;
}
