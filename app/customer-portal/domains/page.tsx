import { requireWorkspaceMember } from "@/lib/auth";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { portalDomainSettings } from "@/lib/data/portal-domains";
import { PortalDomainSettings } from "@/components/portal-domain-settings";

export const metadata = { title: "Portal domain" };
export default async function Page() {
  const viewer = await requireWorkspaceMember();
  const settings = await withWorkspaceViewer(viewer, portalDomainSettings);
  return <PortalDomainSettings key={viewer.workspaceId} {...settings} canWrite={viewer.role === "admin"} />;
}
