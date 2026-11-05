import { z } from "zod";

export const workspaceCookie = "crm_workspace";
export const workspaceIdSchema = z.string().uuid();
export const workspaceNameSchema = z.string().trim().min(2, "Use at least 2 characters for the workspace name.").max(80);
export const workspaceRoleSchema = z.enum(["admin", "operator", "bd_manager", "viewer"]);
export type WorkspaceSummary = { id: string; name: string; slug: string; role: string; ownerId: string };

export function workspaceSlug(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "workspace";
}

export function workspaceCookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 365 * 86400 };
}
