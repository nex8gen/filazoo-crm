import "server-only";

import { requireWorkspaceMember, type WorkspaceRole } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

export type WorkspaceMemberRecord = {
  id: string;
  email: string;
  displayName: string | null;
  role: WorkspaceRole;
  confirmed: boolean;
  lastSignInAt: string | null;
  createdAt: string;
};

export async function listWorkspaceMembers(): Promise<WorkspaceMemberRecord[]> {
  await requireWorkspaceMember(["admin"]);
  const admin = createSupabaseAdmin();
  const [{ data: memberships, error: membershipError }, { data: usersData, error: usersError }] = await Promise.all([
    admin.from("workspace_members").select("user_id,role,display_name,created_at").order("created_at"),
    admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
  ]);

  if (membershipError) throw new Error(`Unable to load team membership: ${membershipError.message}`);
  if (usersError) throw new Error(`Unable to load authentication users: ${usersError.message}`);

  const usersById = new Map(usersData.users.map((user) => [user.id, user]));
  return (memberships ?? []).flatMap((membership) => {
    const user = usersById.get(membership.user_id);
    if (!user?.email) return [];
    return [{
      id: membership.user_id,
      email: user.email,
      displayName: membership.display_name,
      role: membership.role as WorkspaceRole,
      confirmed: Boolean(user.email_confirmed_at),
      lastSignInAt: user.last_sign_in_at ?? null,
      createdAt: membership.created_at,
    }];
  });
}
