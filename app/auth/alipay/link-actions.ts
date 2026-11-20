"use server";

import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { getAuthProviders } from "@/lib/auth-providers";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function connectAlipay(_state: { error?: string } | undefined) {
  void _state;
  await requireViewer();
  if (!(await getAuthProviders()).includes("alipay")) return { error: "Alipay sign-in is awaiting activation." };
  let url: string;
  try {
    const { data, error } = await (await createClient()).auth.linkIdentity({ provider: "custom:alipay", options: {
      redirectTo: new URL("/auth/callback?next=%2Fauth%2Falipay%2Fconnected", env.NEXT_PUBLIC_APP_URL).toString(),
    } });
    if (error || !data.url) return { error: "Unable to connect Alipay. Please try again later." };
    url = data.url;
  } catch { return { error: "Unable to connect Alipay. Please try again later." }; }
  redirect(url);
}
