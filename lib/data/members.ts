import type { User } from "@supabase/supabase-js";
import { requireWorkspaceMember, type WorkspaceRole } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";

export type WorkspaceMemberRecord = {
  id: string;
  email: string;
  displayName: string | null;
  role: WorkspaceRole;
  autoAssignLeads: boolean;
  activated: boolean;
  activatedAt: string | null;
  lastSignInAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BdSalesManager = { id: string; name: string };

export async function listAllAuthUsers(): Promise<User[]> {
  const admin = createSupabaseAdmin();
  const users: User[] = [];
  const perPage = 200;

  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Unable to load authentication users: ${error.message}`);
    users.push(...data.users);
    if (data.users.length < perPage) return users;
  }
}

export async function listBdSalesManagers(): Promise<BdSalesManager[]> {
  await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const { data, error } = await createSupabaseAdmin()
    .from("workspace_members")
    .select("user_id,display_name")
    .eq("role", "bd_manager")
    .eq("auto_assign_leads", true)
    .not("activated_at", "is", null)
    .order("display_name");
  if (error) throw new Error(`Unable to load BD Sales Managers: ${error.message}`);
  return (data ?? []).map((member) => ({ id: member.user_id, name: member.display_name || "BD Sales Manager" }));
}

export async function listWorkspaceMembers(): Promise<WorkspaceMemberRecord[]> {
  await requireWorkspaceMember(["admin"]);
  const admin = createSupabaseAdmin();
  const [{ data: memberships, error: membershipError }, authUsers] = await Promise.all([
    admin.from("workspace_members").select("user_id,role,display_name,auto_assign_leads,activated_at,created_at,updated_at").order("created_at"),
    listAllAuthUsers(),
  ]);

  if (membershipError) throw new Error(`Unable to load team membership: ${membershipError.message}`);

  const usersById = new Map(authUsers.map((user) => [user.id, user]));
  return (memberships ?? []).flatMap((membership) => {
    const user = usersById.get(membership.user_id);
    if (!user?.email) return [];
    return [{
      id: membership.user_id,
      email: user.email,
      displayName: membership.display_name,
      role: membership.role as WorkspaceRole,
      autoAssignLeads: Boolean(membership.auto_assign_leads),
      activated: Boolean(membership.activated_at),
      activatedAt: membership.activated_at ?? null,
      lastSignInAt: user.last_sign_in_at ?? null,
      createdAt: membership.created_at,
      updatedAt: membership.updated_at,
    }];
  });
}
