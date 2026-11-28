import { OnboardingShell } from "@/components/onboarding-shell";
import { requireWorkspaceMember } from "@/lib/auth";
import { readTeamCapacity } from "@/lib/data/team-capacity";
import { SetupWizard } from "./setup-wizard";

export const metadata = { title: "Set up your workspace" };
export const instant = false;

export default async function WorkspaceSetupPage() {
  const viewer = await requireWorkspaceMember();
  const capacity = viewer.role === "admin" && viewer.workspaceId !== "legacy"
    ? await readTeamCapacity(viewer).catch(() => null) : null;
  return <OnboardingShell><SetupWizard key={viewer.workspaceId} workspaceName={viewer.workspaceName}
    canInvite={capacity?.canInvite === true} canAddCustomer={viewer.role !== "viewer"} /></OnboardingShell>;
}
