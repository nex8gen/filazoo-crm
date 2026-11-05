import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { AuthHeading } from "@/components/auth-fields";
import { getWorkspaceViewer } from "@/lib/auth";
import { listMyWorkspaces } from "@/lib/data/workspaces";
import { OpenWorkspaceForm } from "./workspace-forms";

export const metadata = { title: "Your workspaces" };
export const instant = false;
export default async function WorkspacesPage() {
  const [workspaces, viewer] = await Promise.all([listMyWorkspaces(), getWorkspaceViewer()]);
  return <AuthShell footer="Your account. Your teams. Your workspaces."><AuthHeading title="Your workspaces">Choose a workspace to open your CRM. Each team has its own customers, data, and connections.</AuthHeading><div className="space-y-3">
    {workspaces.map(w => <OpenWorkspaceForm key={w.id} {...w} active={viewer?.workspaceId === w.id} />)}
    {!workspaces.length ? <p className="text-sm text-muted-foreground">Create your first workspace, or open an invitation link from your team.</p> : null}
    <Link href="/workspaces/new" className="block rounded-md border border-dashed p-4 text-center text-sm font-medium text-primary hover:bg-muted">+ Create a workspace</Link>
    <form action="/auth/signout" method="post"><button className="w-full p-2 text-xs text-muted-foreground hover:text-foreground">Sign out</button></form>
  </div></AuthShell>;
}
