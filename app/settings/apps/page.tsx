import { LayoutGrid } from "lucide-react";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { SettingsSkeleton } from "@/components/settings-skeleton";
import { Badge } from "@/components/ui/badge";
import { requireWorkspaceMember } from "@/lib/auth";
import { getAppConnectionSummaries, getEmailConnectionsOverview } from "@/lib/data/app-connections";
import { EmailConnectionsHub } from "./email-connections-hub";
import type { EmailConnectionsView } from "@/lib/email-connections";
import { SettingsNavigation } from "../settings-navigation";

export const metadata = { title: "Apps & connections" };

type Props = { searchParams: Promise<{ view?: string }> };

export default function AppsConnectionsPage(props: Props) {
  return <Suspense fallback={<SettingsSkeleton section="apps" />}><AppsConnectionsWorkspace {...props} /></Suspense>;
}

async function AppsConnectionsWorkspace({ searchParams }: Props) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const [connections, overview, query] = await Promise.all([getAppConnectionSummaries(), getEmailConnectionsOverview(), searchParams]);
  const initialView: EmailConnectionsView = query.view === "personal" || query.view === "team" ? query.view : "apps";

  return (
    <div className="flex min-h-[calc(100dvh-3rem)] flex-col md:flex-row">
      <SettingsNavigation isAdmin={viewer.role === "admin"} />
      <div className="min-w-0 flex-1 p-5 sm:p-8 lg:p-10">
        <div className="mx-auto max-w-6xl">
          <PageHeader
            title="Apps & connections"
            description="Connect your apps and manage personal and team email accounts in one place."
            actions={<Badge variant="outline" className="gap-1.5"><LayoutGrid className="size-3.5" />Preview</Badge>}
          />
          <EmailConnectionsHub connections={connections} overview={overview} isAdmin={viewer.role === "admin"} initialView={initialView} />
        </div>
      </div>
    </div>
  );
}
