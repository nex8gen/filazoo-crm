import { requireWorkspaceMember } from "@/lib/auth";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { getPortalDesign } from "@/lib/data/portal-design";
import { canManagePortal } from "@/lib/portal-design";
import { PortalThemeLibrary } from "@/components/portal-theme-library";
import { portalDomainSettings } from "@/lib/data/portal-domains";

export const metadata = { title: "Customer portal themes" };

export default async function PortalBuilderPage() {
  const viewer = await requireWorkspaceMember();
  const [design, domain] = await withWorkspaceViewer(viewer, () => Promise.all([
    getPortalDesign(viewer.workspaceName),
    portalDomainSettings().then(settings => ({ domain: settings.domain, hostingReady: settings.hostingReady, available: true })).catch(() => ({ domain: null, hostingReady: false, available: false })),
  ]));
  return <PortalThemeLibrary key={viewer.workspaceId} initial={design} domainSettings={domain} canWrite={canManagePortal(viewer.role)} workspaceName={viewer.workspaceName} />;
}
