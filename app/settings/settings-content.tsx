"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { settingsSectionForPath } from "@/lib/settings-sections";

export function SettingsContent({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const section = settingsSectionForPath(pathname);
  return <div className="settings-main" data-settings-section={section?.id}>
    <div className="settings-scroll-content">{section && section.id !== "credits" && pathname === section.href ? <header className="settings-page-heading"><h1>{section.title}</h1></header> : null}{children}</div>
  </div>;
}
