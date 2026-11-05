import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { AuthHeading } from "@/components/auth-fields";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { WorkspaceNameForm } from "../workspace-forms";

export const metadata = { title: "Create workspace" };
export const instant = false;
export default async function NewWorkspacePage() {
  await requireViewer();
  const { data } = await (await createClient()).auth.getUser();
  const name = data.user?.user_metadata?.workspace_name;
  return <AuthShell step={3}><AuthHeading title="Make room for your business">Create a private workspace for your customers, conversations, and team.</AuthHeading><div className="mb-7 rounded-[10px] border border-black/15 p-4 text-sm leading-6 text-black/60 dark:border-white/15 dark:text-white/60">You will be the owner and administrator. Your CRM starts empty, and only people you invite can join. You can create or join other workspaces with the same account.</div><WorkspaceNameForm name={typeof name === "string" ? name : ""} /><Link href="/workspaces" className="mt-6 text-center text-sm text-black/60 underline underline-offset-4 dark:text-white/60">Back to your workspaces</Link></AuthShell>;
}
