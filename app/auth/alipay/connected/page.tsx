import Link from "next/link";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AuthShell } from "@/components/auth-shell";
import { AuthHeading } from "@/components/auth-fields";

export const instant = false;
export default async function AlipayConnectedPage() {
  await requireViewer();
  const { data: { user } } = await (await createClient()).auth.getUser();
  const connected = user?.identities?.some(identity => identity.provider === "custom:alipay");
  return <AuthShell><AuthHeading title={connected ? "Alipay connected" : "Alipay is not connected"}>{connected ? "You can now sign in with Alipay and keep your existing account and workspace access." : "Sign in with your existing email and connect Alipay from your profile."}</AuthHeading><Link href="/settings/profile" className="underline">Back to profile</Link></AuthShell>;
}
