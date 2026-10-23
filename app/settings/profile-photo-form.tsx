"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/user-avatar";
import { AVATAR_PRESETS, type AvatarPreset } from "@/lib/profile-avatar";
import { saveProfileAvatar } from "./profile-actions";

async function resizePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 384;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not process this photo.");
    const side = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 384, 384);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Choose another photo.")), "image/webp", 0.85));
  } finally {
    bitmap.close();
  }
}

export function ProfilePhotoForm({ userId, name, imageUrl, preset }: { userId: string; name: string; imageUrl?: string; preset: AvatarPreset }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [selectedPreset, setSelectedPreset] = useState(preset);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});

  async function save(nextPreset: AvatarPreset, file?: File, removePhoto = false) {
    setPending(true);
    setMessage({});
    try {
      const data = new FormData();
      data.set("preset", nextPreset);
      if (file) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error("Choose a JPG, PNG, or WebP photo under 10 MB.");
        data.set("photo", await resizePhoto(file), "avatar.webp");
      }
      if (removePhoto) data.set("removePhoto", "true");
      const result = await saveProfileAvatar(data);
      setMessage(result);
      if (!result.error) {
        setSelectedPreset(nextPreset);
        router.refresh();
      }
    } catch (error) {
      setMessage({ error: error instanceof Error ? error.message : "Your photo could not be saved. Please try again." });
    } finally {
      setPending(false);
      if (input.current) input.current.value = "";
    }
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-4">
      <UserAvatar userId={userId} name={name} imageUrl={imageUrl} preset={selectedPreset} className="size-20" />
      <div className="space-y-2"><p className="text-sm font-medium">Profile photo</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => input.current?.click()}>{pending ? <Loader2 className="animate-spin" /> : <Camera />}Upload photo</Button>{imageUrl ? <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void save(selectedPreset, undefined, true)}>Remove photo</Button> : null}</div><p className="text-xs text-muted-foreground">JPG, PNG, or WebP, up to 10 MB. Photos are cropped to a square.</p></div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload profile photo" className="sr-only" disabled={pending} onChange={(event) => { const file = event.target.files?.[0]; if (file) void save(selectedPreset, file); }} />
    </div>
    <fieldset disabled={pending} className="space-y-3"><legend className="text-sm font-medium">Default avatar</legend><p className="text-xs text-muted-foreground">Choose a character to use instead of a photo. Your selection saves automatically.</p><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{AVATAR_PRESETS.map((option) => <button key={option.id} type="button" aria-label={`Use ${option.label} avatar`} aria-pressed={!imageUrl && selectedPreset === option.id} onClick={() => void save(option.id, undefined, true)} className={`relative flex min-w-0 flex-col items-center gap-3 rounded-xl border p-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${!imageUrl && selectedPreset === option.id ? "border-primary bg-primary/5" : "hover:bg-muted"}`}><UserAvatar userId={userId} name={option.label} preset={option.id} className="size-16 sm:size-20" /><span>{option.label}</span>{!imageUrl && selectedPreset === option.id ? <Check className="absolute right-1.5 top-1.5 size-3.5 text-primary" /> : null}</button>)}</div></fieldset>
    {message.error ? <p role="alert" className="text-xs text-destructive">{message.error}</p> : message.success ? <p role="status" className="text-xs text-primary">{message.success}</p> : null}
  </div>;
}
