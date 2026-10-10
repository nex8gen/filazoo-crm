import { Mail, Plus } from "lucide-react";
import { EmptyState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";

export default function EmailsPage() {
  return <div><PageHeader title="Emails" description="Review personalized drafts and keep every outbound message controlled." actions={<Button size="sm"><Plus /> New sequence</Button>} /><EmptyState icon={Mail} title="No email drafts yet" description="Qualified contacts and approved sequences will appear here when outreach begins." action={{ label: "Create sequence" }} /></div>;
}
