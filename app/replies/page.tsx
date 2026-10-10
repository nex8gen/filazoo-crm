import { MessageSquareReply } from "lucide-react";
import { EmptyState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";

export default function RepliesPage() {
  return <div><PageHeader title="Replies" description="Triage inbound conversations and surface buying signals quickly." /><EmptyState icon={MessageSquareReply} title="Your reply inbox is clear" description="Customer replies will appear here with suggested classifications and next actions." /></div>;
}
