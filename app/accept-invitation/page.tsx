import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { getViewer } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { AcceptInvitationForm } from "./accept-invitation-form";

export const metadata: Metadata = { title: "Accept invitation" };
export const instant = false;

export default async function AcceptInvitationPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/auth/error?reason=invalid-link");

  const { data: membership, error } = await createSupabaseAdmin()
    .from("workspace_members")
    .select("display_name,role,activated_at")
    .eq("user_id", viewer.id)
    .maybeSingle();
  if (error || !membership) redirect("/access-denied");
  if (membership.activated_at) redirect("/login?message=This%20account%20is%20already%20active.");

  return (
    <AuthShell animatedBackground footer="Secure Filazoo workspace invitation">
      <AcceptInvitationForm email={viewer.email || ""} displayName={membership.display_name || ""} role={membership.role} />
    </AuthShell>
  );
}
