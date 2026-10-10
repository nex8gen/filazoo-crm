import { Mail } from "lucide-react";
import { NewEmailDraftButton } from "@/components/crm-action-dialogs";
import { EmptyState } from "@/components/data-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireWorkspaceMember } from "@/lib/auth";
import { listContactOptions, listEmailDrafts } from "@/lib/data/crm";

export default async function EmailsPage() {
  const viewer = await requireWorkspaceMember(["admin", "operator", "viewer"]);
  const [{ emails }, { contacts }] = await Promise.all([listEmailDrafts(), listContactOptions()]);
  const canWrite = viewer.role !== "viewer";

  return (
    <div>
      <PageHeader title="Emails" description="Review personalized drafts and keep every outbound message controlled." actions={<NewEmailDraftButton contacts={contacts} canWrite={canWrite} />} />
      {emails.length === 0 ? (
        <EmptyState icon={Mail} title="No email drafts yet" description="Create a safe draft for a contact. Nothing can be sent from this screen.">
          <NewEmailDraftButton contacts={contacts} canWrite={canWrite} label="Create sequence" />
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {emails.map((email) => (
            <Card key={email.id} className="shadow-none">
              <CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="text-sm">{email.subject}</CardTitle><CardDescription className="text-xs">{email.company} · {email.contact}</CardDescription></div><Badge variant="outline">{email.status}</Badge></div></CardHeader>
              <CardContent className="space-y-3"><p className="line-clamp-3 text-sm text-muted-foreground">{email.preview}</p><div className="flex justify-between border-t pt-3 text-xs text-muted-foreground"><span>Step {email.step}</span><span>{email.scheduledFor}</span></div></CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
