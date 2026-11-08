import { Activity, Kanban, LayoutDashboard, MailCheck, ReceiptText, Reply, Settings, Workflow } from "lucide-react";
import { navigation } from "@/lib/navigation";
import { settingsSectionForPath } from "@/lib/settings-sections";
import { PageHeader } from "@/components/page-header";

const pages = [
  ...navigation.flatMap(group => group.items),
  { href: "/invoices", label: "Invoice", icon: ReceiptText },
  { href: "/email/workflows", label: "Email workflows", icon: Workflow },
  { href: "/automation", label: "Automation", icon: Workflow },
  { href: "/deliverability", label: "Deliverability", icon: MailCheck },
  { href: "/pipeline", label: "Pipeline", icon: Kanban },
  { href: "/replies", label: "Replies", icon: Reply },
  { href: "/lead-channel/meta", label: "Meta Leads", icon: Activity },
].sort((a, b) => b.href.length - a.href.length);

export function WorkspacePageHeader({ pathname }: { pathname: string }) {
  if (pathname === "/") return null;
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return <PageHeader title={settingsSectionForPath(pathname)?.title ?? "Settings"} icon={Settings} />;
  }

  const page = pages.find(page => pathname === page.href || pathname.startsWith(`${page.href}/`));
  return <PageHeader title={page?.label ?? "Overview"} icon={page?.icon ?? LayoutDashboard} />;
}
