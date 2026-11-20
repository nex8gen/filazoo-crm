import { safeInternalPath } from "./safe-redirect.ts";

/** Sign-in starts at Home; account setup and recovery must still finish. */
export function loginDestination(value: unknown) {
  const path = safeInternalPath(value);
  return path === "/auth/alipay/connected" || /^\/(?:join|accept-invitation|workspaces|subscribe|update-password)(?:[/?#]|$)/.test(path) ? path : "/";
}
