import { createClient } from "@supabase/supabase-js";
import { env } from "../env.ts";
import { currentWorkspaceContext } from "../workspace-context.ts";
import { workspaceFetch } from "./workspace-fetch.ts";

export function createSupabaseAdmin() {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.supabaseSecretKey) throw new Error("Supabase is not configured. Add its URL and secret key to the server environment.");
  // Resolve lazily, once per client. Authentication itself uses the separate control client.
  let scope: Promise<{ workspaceId: string; userId?: string } | null> | undefined;
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: workspaceFetch(async () => {
      const explicit = currentWorkspaceContext();
      if (explicit) return explicit;
      scope ??= import("../auth.ts").then(async ({ getWorkspaceViewer }) => {
        try {
          const viewer = await getWorkspaceViewer();
          return viewer ? { workspaceId: viewer.workspaceId, userId: viewer.id } : null;
        } catch (error) {
          // CLI workers have no Next request; unscoped trusted jobs stay in the legacy workspace.
          if (error instanceof Error && /outside a request scope/.test(error.message)) return null;
          throw error;
        }
      });
      return scope;
    }) },
  });
}
