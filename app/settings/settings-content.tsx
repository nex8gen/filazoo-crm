"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { WorkspacePageHeader } from "@/components/workspace-page-header";
import { settingsSectionForPath } from "@/lib/settings-sections";

export function SettingsContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const section = settingsSectionForPath(pathname);
  return <div className="settings-main">
    <WorkspacePageHeader pathname={pathname} />
    <div className="settings-scroll-content">{section ? <div className="settings-section-intro"><span className="settings-scope">{section.group === "Personal" ? "Personal settings" : section.group === "Connections" ? "Connection settings" : "Workspace settings"}</span><p>{section.description}</p></div> : null}{children}</div>
  </div>;
}
