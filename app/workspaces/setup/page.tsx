import Link from "next/link";
import { ArrowRight, Building2, Check, Mail, Users } from "lucide-react";
import { AuthShell } from "@/components/auth-shell";
import { AuthHeading, authButtonClass } from "@/components/auth-fields";
import { requireWorkspaceMember } from "@/lib/auth";

export const metadata = { title: "Get started" };
export const instant = false;

export default async function WorkspaceSetupPage() {
  const viewer = await requireWorkspaceMember();
  const admin = viewer.role === "admin";
  const steps = [
    ...(admin ? [{ title: "Invite your team", description: "Share your workspace and choose each person's access.", href: "/settings/team", icon: Users }] : []),
    { title: "Connect your email", description: "Bring your customer conversations into your CRM.", href: "/settings/apps", icon: Mail },
    { title: "Add your first customer", description: "Start building relationships with a company or contact.", href: "/companies", icon: Building2 },
  ];
  return <AuthShell step={4}><div className="mb-6 flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><Check className="size-6" /></div><AuthHeading title="Your workspace is ready">Welcome to <span className="break-words font-medium text-black dark:text-white">{viewer.workspaceName}</span>. Start with what matters to you.</AuthHeading><div className="space-y-3">{steps.map(({ title, description, href, icon: Icon }) => <Link key={href} href={href} className="group flex items-center gap-4 rounded-[10px] border border-black/20 p-5 transition-colors hover:bg-black/[0.03] dark:border-white/15 dark:hover:bg-white/5"><Icon className="size-5 shrink-0" /><div className="min-w-0 flex-1"><h2 className="font-medium">{title}</h2><p className="mt-1 text-sm leading-5 text-black/60 dark:text-white/60">{description}</p></div><ArrowRight className="size-4 shrink-0 transition-transform group-hover:translate-x-1" /></Link>)}</div><Link href="/analytics" className={`mt-8 ${authButtonClass}`}>Open your CRM<ArrowRight className="size-4" /></Link><p className="mt-4 text-center text-xs leading-5 text-black/55 dark:text-white/55">These steps are optional. You can return to them from Settings at any time.</p></AuthShell>;
}
