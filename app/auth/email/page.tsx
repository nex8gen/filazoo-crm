import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { loginDestination } from "@/lib/login-destination";
import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "@/components/auth-shell";
import { AuthHeading } from "@/components/auth-fields";
import { AccountEmailForm } from "./email-form";

export const metadata = { title: "Verify your account email" };
export const instant = false;
export default async function AccountEmailPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  await requireViewer();
  const next = loginDestination((await searchParams).next);
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (user?.email && user.email_confirmed_at) redirect(next);
  return <AuthShell><AuthHeading title="Add your account email">Alipay does not share a verified email. Verify your email to finish setting up your Filazoo account and receive workspace invitations.</AuthHeading><AccountEmailForm next={next} /></AuthShell>;
}
