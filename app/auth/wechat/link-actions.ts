"use server";

import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";
import { getAuthProviders } from "@/lib/auth-providers";
import { env } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function connectWechat(_state: { error?: string } | undefined) {
  void _state;
  await requireViewer();
  if (!(await getAuthProviders()).includes("wechat")) return { error: "WeChat sign-in is awaiting activation." };
  let url: string;
  try {
    const { data, error } = await (await createClient()).auth.linkIdentity({ provider: "custom:wechat", options: {
      redirectTo: new URL("/auth/callback?next=%2Fsettings%2Fsecurity", env.NEXT_PUBLIC_APP_URL).toString(),
    } });
    if (error || !data.url) return { error: "Unable to connect WeChat. Please try again later." };
    url = data.url;
  } catch { return { error: "Unable to connect WeChat. Please try again later." }; }
  redirect(url);
}
