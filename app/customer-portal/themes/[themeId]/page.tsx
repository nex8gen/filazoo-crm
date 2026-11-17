import { notFound } from "next/navigation";
import { requireWorkspaceMember } from "@/lib/auth";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { getPortalDesign } from "@/lib/data/portal-design";
import { canManagePortal } from "@/lib/portal-design";
import { portalLibraryThemes, portalThemeIdSchema } from "@/lib/portal-themes";
import { PortalBuilder } from "@/components/portal-builder";
export const metadata = { title: "Edit portal theme" };
export default async function ThemeEditorPage({ params }: { params: Promise<{ themeId: string }> }) {
  const viewer = await requireWorkspaceMember();
  const { themeId } = await params;
  if (!portalThemeIdSchema.safeParse(themeId).success) notFound();
  const view = await withWorkspaceViewer(viewer, getPortalDesign);
  const theme = portalLibraryThemes(view).find(item => item.id === themeId);
  if (!theme) notFound();
  return <PortalBuilder key={`${viewer.workspaceId}:${themeId}`} initial={{ ...view, draft: theme.design }} themeId={themeId} themeName={theme.name} canWrite={canManagePortal(viewer.role)} workspaceName={viewer.workspaceName} />;
}
