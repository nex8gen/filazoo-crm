import { safeInternalPath } from "./safe-redirect.ts";

/** Sign-in starts at Home; account setup and recovery must still finish. */
export function loginDestination(value: unknown) {
  const path = safeInternalPath(value);
  return /^\/(?:join|accept-invitation|workspaces|update-password)(?:[/?#]|$)/.test(path) ? path : "/";
}
