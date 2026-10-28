import "server-only";
import { cacheLife, cacheTag } from "next/cache.js";
import { env } from "../env.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { resolveMemberAvatars as readMemberAvatars } from "./member-avatars.ts";

async function cachedAvatar(projectUrl: string, id: string): Promise<string | undefined> {
  "use cache";
  // This caches display URLs only. Membership, permissions and CRM data remain
  // request-scoped. Expire before the private Storage URL's one-hour lifetime.
  cacheLife({ stale: 60, revalidate: 300, expire: 3300 });
  cacheTag(`member-avatar:${id}`);
  if (!projectUrl) return undefined;
  const avatars = await readMemberAvatars(createSupabaseAdmin(), [id]);
  const avatar = avatars.get(id);
  if (!avatar) throw new Error("Member avatar unavailable.");
  return avatar;
}

/** Call only after authorizing the containing workspace data. */
export async function resolveMemberAvatars(userIds: readonly string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const avatars = new Map<string, string>();
  for (let start = 0; start < ids.length; start += 8) {
    await Promise.allSettled(ids.slice(start, start + 8).map(async id => {
      const url = await cachedAvatar(env.NEXT_PUBLIC_SUPABASE_URL || "", id);
      if (url) avatars.set(id, url);
    }));
  }
  return avatars;
}
