"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { WorkspacePageHeader } from "@/components/workspace-page-header";

export function SettingsContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <div className="settings-main">
    <WorkspacePageHeader pathname={pathname} />
    <div className="settings-scroll-content">{children}</div>
  </div>;
}
