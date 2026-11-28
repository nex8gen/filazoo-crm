"use client";
import { NotificationToast } from "@/components/ui/notification-toast";


import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/user-avatar";
import { AVATAR_PRESETS, type AvatarPreset } from "@/lib/profile-avatar";
import { resizeProfilePhoto } from "@/lib/profile-photo";
import { saveProfileAvatar } from "./profile-actions";

export function ProfilePhotoForm({ userId, name, imageUrl, preset }: { userId: string; name: string; imageUrl?: string; preset: AvatarPreset }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const saving = useRef(false);
  const [message, setMessage] = useState<{ error?: string; success?: string }>({});

  function save(nextPreset: AvatarPreset, file?: File, removePhoto = false) {
    if (pending || saving.current) return;
    saving.current = true;
    setMessage({});
    startTransition(async () => {
      try {
        const data = new FormData();
        data.set("preset", nextPreset);
        if (file) {
          if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error("Choose a JPG, PNG, or WebP photo under 10 MB.");
          data.set("photo", await resizeProfilePhoto(file), "avatar.webp");
        }
        if (removePhoto) data.set("removePhoto", "true");
        const result = await saveProfileAvatar(data);
        setMessage(result);
        if (!result.error) {
          startTransition(() => router.refresh());
        }
      } catch (error) {
        setMessage({ error: error instanceof Error ? error.message : "Your photo could not be saved. Please try again." });
      } finally {
        saving.current = false;
        if (input.current) input.current.value = "";
      }
    });
  }

  return <Dialog>
    <div className="profile-photo">
      <UserAvatar userId={userId} name={name} imageUrl={imageUrl} preset={preset} className="size-24 sm:size-28" />
      <DialogTrigger render={<Button type="button" variant="outline" size="icon-sm" className="profile-photo-edit" aria-label="Edit profile photo" />}><Pencil aria-hidden="true" /></DialogTrigger>
    </div>
    <DialogContent className="settings-field-dialog sm:max-w-lg">
    <DialogHeader><DialogTitle>Profile photo</DialogTitle><DialogDescription>Upload a photo or choose an avatar.</DialogDescription></DialogHeader>
    <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-4">
      <UserAvatar userId={userId} name={name} imageUrl={imageUrl} preset={preset} className="size-20" />
      <div className="space-y-2"><p className="text-sm font-medium">Profile photo</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => input.current?.click()}>{pending ? <Loader2 className="animate-spin" /> : <Camera />}Upload photo</Button>{imageUrl ? <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => void save(preset, undefined, true)}>Remove photo</Button> : null}</div><p className="text-xs text-muted-foreground">JPG, PNG, or WebP, up to 10 MB. Photos are cropped to a square.</p></div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Upload profile photo" className="sr-only" disabled={pending} onChange={(event) => { const file = event.target.files?.[0]; if (file) void save(preset, file); }} />
    </div>
    <fieldset disabled={pending} className="space-y-3"><legend className="text-sm font-medium">Default avatar</legend><p className="text-xs text-muted-foreground">Your selection saves automatically.</p><div className="grid grid-cols-3 gap-2 sm:grid-cols-5">{AVATAR_PRESETS.map((option) => <button key={option.id} type="button" aria-label={`Use ${option.label} avatar`} aria-pressed={!imageUrl && preset === option.id} onClick={() => void save(option.id, undefined, true)} className="settings-panel relative flex min-w-0 flex-col items-center gap-2 px-1 py-3 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"><UserAvatar userId={userId} name={option.label} preset={option.id} className="size-12" /><span>{option.label}</span>{!imageUrl && preset === option.id ? <Check aria-hidden="true" className="absolute right-1 top-1 size-3 text-primary" /> : null}</button>)}</div></fieldset>
    {message.error ? <NotificationToast>{message.error}</NotificationToast> : message.success ? <p role="status" className="text-xs text-primary">{message.success}</p> : null}
    </div>
    </DialogContent>
  </Dialog>;
}
