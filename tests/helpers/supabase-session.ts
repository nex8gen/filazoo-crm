import { authFetch } from "../../lib/supabase/auth-fetch.ts";
import { isTransientAuthError } from "../../lib/supabase/auth-error.ts";
import { workspaceSessionUnavailableResponse } from "../../lib/workspace-session-response.ts";

export const supabaseSessionDependencies: Record<string, unknown> = {
  "./auth-fetch.ts": { authFetch },
  "./auth-error.ts": { isTransientAuthError },
  "./supabase/auth-error.ts": { isTransientAuthError },
  "../workspace-session-response.ts": { workspaceSessionUnavailableResponse },
};
