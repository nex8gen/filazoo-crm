import { Suspense } from "react";
import { SettingsSkeleton } from "@/components/settings-skeleton";
import { requireWorkspaceMember } from "@/lib/auth";
import { GeneralSettings } from "./general-settings";

export default function SettingsPage() {
  return <Suspense fallback={<SettingsSkeleton />}><GeneralWorkspace /></Suspense>;
}

async function GeneralWorkspace() {
  await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  return <GeneralSettings />;
}
