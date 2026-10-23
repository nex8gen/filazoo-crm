"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AVATAR_PRESETS, type AvatarPreset } from "@/lib/profile-avatar";

export function UserAvatar({ name, imageUrl, preset = "male", className }: { userId: string; name: string; imageUrl?: string; preset?: AvatarPreset; className?: string }) {
  const fallback = (AVATAR_PRESETS.find((option) => option.id === preset) ?? AVATAR_PRESETS[0]).image;

  return <Avatar className={className}>
    <AvatarImage src={imageUrl || fallback} alt={name} />
    <AvatarFallback className="overflow-hidden bg-brand-soft">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={fallback} alt={name} className="size-full rounded-full object-cover" />
    </AvatarFallback>
  </Avatar>;
}
