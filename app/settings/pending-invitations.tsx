import { requireWorkspaceMember } from "@/lib/auth";
import { createSupabaseControl } from "@/lib/supabase/control";
import { RevokeInvitationForm } from "./team-workspace-controls";

export async function PendingInvitations() {
  const viewer = await requireWorkspaceMember(["admin"]);
  if (viewer.workspaceId === "legacy") return null;
  const { data, error } = await createSupabaseControl().from("workspace_invitations").select("id,email,role,expires_at")
    .eq("workspace_id", viewer.workspaceId).is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false });
  if (error) return <p role="status" className="settings-panel p-4 text-sm text-muted-foreground">Unable to load pending invitations. Refresh to try again.</p>;
  if (!data?.length) return null;
  return <section className="settings-form-row"><div className="settings-row-heading"><h2>Pending invitations</h2></div><div className="settings-row-content space-y-3">{data.map(invite => <div key={invite.id} className="settings-panel flex flex-wrap items-center justify-between gap-3 p-3"><div><p className="text-sm">{invite.email}</p><p className="text-xs capitalize text-muted-foreground">{invite.role.replace("_", " ")} · Valid until {new Date(invite.expires_at).toLocaleDateString("en", { timeZone: "UTC" })}</p></div><RevokeInvitationForm id={invite.id} /></div>)}</div></section>;
}
