"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { WorkspacePageHeader } from "@/components/workspace-page-header";
import { settingsSectionForPath } from "@/lib/settings-sections";

export function SettingsContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const section = settingsSectionForPath(pathname);
  return <div className="settings-main" data-settings-section={section?.id}>
    <WorkspacePageHeader pathname={pathname} />
    <div className="settings-scroll-content">{section && pathname !== "/settings/credits" ? <div className="settings-section-intro"><p>{section.description}</p></div> : null}{children}</div>
  </div>;
}
