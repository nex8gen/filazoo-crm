import { MessageSquareReply } from "lucide-react";
import { EmptyState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listReplies } from "@/lib/data/crm";

export default async function RepliesPage() {
  const { replies } = await listReplies();
  return (
    <div>
      <PageHeader title="Replies" description="Triage inbound conversations and surface buying signals quickly." />
      {replies.length === 0 ? (
        <EmptyState icon={MessageSquareReply} title="Your reply inbox is clear" description="Customer replies will appear here with their related company and contact." />
      ) : (
        <div className="space-y-4">
          {replies.map((reply) => (
            <Card key={reply.id} className="shadow-none">
              <CardHeader><CardTitle className="text-sm">{reply.subject}</CardTitle><CardDescription className="text-xs">{reply.company} · {reply.contact} · {new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(reply.receivedAt))}</CardDescription></CardHeader>
              <CardContent><p className="whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{reply.body}</p></CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
