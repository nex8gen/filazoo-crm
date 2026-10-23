export const PROFILE_AVATAR_BUCKET = "profile-avatars";
export const PROFILE_AVATAR_MAX_BYTES = 512 * 1024;
export const AVATAR_PRESETS = [
  { id: "male", label: "Headphones", image: "/avatars/headphones.webp" },
  { id: "female", label: "Green beanie", image: "/avatars/green-beanie.webp" },
  { id: "curly", label: "Black curls", image: "/avatars/black-curls.webp" },
  { id: "lavender", label: "Lavender", image: "/avatars/lavender.webp" },
  { id: "glasses", label: "Round glasses", image: "/avatars/round-glasses.webp" },
] as const;
export type AvatarPreset = (typeof AVATAR_PRESETS)[number]["id"];

export function isAvatarPreset(value: unknown): value is AvatarPreset {
  return AVATAR_PRESETS.some((preset) => preset.id === value);
}

export function ownAvatarPath(userId: string, path: unknown): string | null {
  if (typeof path !== "string" || !path.startsWith(`${userId}/`)) return null;
  return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$/.test(path.slice(userId.length + 1)) ? path : null;
}

export function profileAvatarUrl(userId: string, path: unknown): string | undefined {
  const ownedPath = ownAvatarPath(userId, path);
  return ownedPath ? `/api/profile/avatar?v=${encodeURIComponent(ownedPath.split("/")[1])}` : undefined;
}

export function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
}
