import { Suspense } from "react";
import { SettingsSkeleton } from "@/components/settings-skeleton";
import { requireWorkspaceMember } from "@/lib/auth";
import { getAppConnectionSummaries, getEmailConnectionsOverview } from "@/lib/data/app-connections";
import { EmailConnectionsHub } from "./email-connections-hub";
import type { EmailConnectionsView } from "@/lib/email-connections";

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
        <div className="settings-content settings-section-enter space-y-6">
          <EmailConnectionsHub connections={connections} overview={overview} isAdmin={viewer.role === "admin"} initialView={initialView} />
        </div>
  );
}
