import { requireWorkspaceMember } from "@/lib/auth";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { getPortalDesign } from "@/lib/data/portal-design";
import { canManagePortal } from "@/lib/portal-design";
import { PortalThemeLibrary } from "@/components/portal-theme-library";

export const metadata = { title: "Customer portal themes" };

export default async function PortalBuilderPage() {
  const viewer = await requireWorkspaceMember();
  const design = await withWorkspaceViewer(viewer, getPortalDesign);
  return <PortalThemeLibrary key={viewer.workspaceId} initial={design} canWrite={canManagePortal(viewer.role)} workspaceName={viewer.workspaceName} />;
}
