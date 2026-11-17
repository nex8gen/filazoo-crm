"use server";
import { requireWorkspaceMember } from "@/lib/auth";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { portalDomainInput } from "@/lib/portal-domains";
import { connectPortalDomain, disconnectPortalDomain, verifyPortalDomain, portalDomainSettings } from "@/lib/data/portal-domains";
import { revalidatePath } from "next/cache";

export async function updatePortalDomain(action: "connect" | "verify" | "disconnect", hostname?: string) {
  const viewer = await requireWorkspaceMember(["admin"]);
  try {
    const domain = await withWorkspaceViewer(viewer, async () => {
      if (action === "connect") {
        const parsed = portalDomainInput.safeParse(hostname);
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Enter a valid domain.");
        return connectPortalDomain(parsed.data);
      }
      if (action === "verify") return verifyPortalDomain();
      if (action === "disconnect") { await disconnectPortalDomain(); return null; }
      throw new Error("Choose a valid domain action.");
    });
    revalidatePath("/customer-portal/domains");
    return { domain };
  } catch (error) {
    const settings = await withWorkspaceViewer(viewer, portalDomainSettings).catch(() => null);
    return { error: error instanceof Error ? error.message : "Unable to update the portal domain.", ...(settings ? { domain: settings.domain } : {}) };
  }
}
