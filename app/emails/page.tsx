import { EmailInboxWorkspace } from "@/components/email-inbox";
import { requireWorkspaceMember } from "@/lib/auth";
import { getEmailInboxBackendData } from "@/lib/email-inbox";

export default async function EmailsPage() {
  await requireWorkspaceMember(["admin", "operator", "viewer"]);
  const { emails, mailboxConfigured, sendConfigured, inboxConfigured, inboxError, aiConfigured, defaultMailboxEmail, mode, automation } = await getEmailInboxBackendData();

  return (
    <EmailInboxWorkspace
      initialEmails={emails}
      mailboxConfigured={mailboxConfigured}
      sendConfigured={sendConfigured}
      inboxConfigured={inboxConfigured}
      inboxError={inboxError}
      aiConfigured={aiConfigured}
      defaultMailboxEmail={defaultMailboxEmail}
      dataMode={mode}
      initialAutomation={automation}
    />
  );
}
