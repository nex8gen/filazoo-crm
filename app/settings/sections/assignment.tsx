import { NotificationToast } from "@/components/ui/notification-toast";
import type { WorkspaceViewer } from "@/lib/auth";
import { getLeadAssignmentSettings } from "@/lib/data/lead-assignment-settings";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { LeadAssignmentForm } from "../lead-assignment-form";

export async function AssignmentSection({ viewer }: { viewer: WorkspaceViewer }) {
  const assignment = await withWorkspaceViewer(viewer, () => getLeadAssignmentSettings(viewer.id).then(data => ({ data, error: "" })).catch(error => ({ data: null, error: error instanceof Error ? error.message : "Unable to load lead assignment controls." })));
  return <div className="settings-content settings-section-enter !max-w-5xl space-y-5">{assignment.data ? <LeadAssignmentForm initial={assignment.data} /> : <NotificationToast>{assignment.error}</NotificationToast>}</div>;
}
