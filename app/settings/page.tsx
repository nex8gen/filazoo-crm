import { Settings } from "lucide-react";
import { EmptyState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";

export default function SettingsPage() {
  return <div><PageHeader title="Settings" description="Configure workspace preferences, team access, and future integrations." /><EmptyState icon={Settings} title="Settings are coming next" description="Workspace controls will be connected when the product moves beyond the interface prototype." /></div>;
}
