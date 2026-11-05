import { requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseControl } from "@/lib/supabase/control";
import { RevokeInvitationForm } from "./team-workspace-controls";

export async function PendingInvitations() {
  const viewer = await requireWorkspaceMember(["admin"]);
  if (viewer.workspaceId === "legacy") return <p className="text-sm text-muted-foreground">Workspace upgrades are awaiting database rollout. Your existing team access is preserved.</p>;
  const { data, error } = await createSupabaseControl().from("workspace_invitations").select("id,email,role,expires_at")
    .eq("workspace_id", viewer.workspaceId).is("accepted_at", null).is("revoked_at", null).order("created_at", { ascending: false });
  if (error) return <p role="alert" className="text-sm text-destructive">Unable to load pending invitations.</p>;
  if (!data?.length) return null;
  return <section className="space-y-3"><h3 className="text-sm font-semibold">Pending invitations</h3>{data.map(invite => <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"><div><p className="text-sm">{invite.email}</p><p className="text-xs capitalize text-muted-foreground">{invite.role.replace("_", " ")} · Valid until {new Date(invite.expires_at).toLocaleDateString("en", { timeZone: "UTC" })}</p></div><RevokeInvitationForm id={invite.id} /></div>)}</section>;
}
