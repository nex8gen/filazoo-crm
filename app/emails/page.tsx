import { EmailsDashboard } from "@/components/emails-dashboard";
import { requireWorkspaceMember } from "@/lib/auth";
import { listEmailDrafts } from "@/lib/data/crm";

export default async function EmailsPage() {
  await requireWorkspaceMember(["admin", "operator", "viewer"]);
  const { emails } = await listEmailDrafts();

  const rows = emails.map((email) => ({
    id: email.id,
    subject: email.subject,
    contact: email.contact,
    company: email.company,
    sequence: "Intro sequence",
    step: `Step ${email.step} of 3`,
    owner: "Ava R.",
    status: email.status,
    scheduledFor: email.scheduledFor || "Not scheduled",
    updatedAt: "Today, 09:14",
    preview: email.preview,
    body: `Hi ${email.contact.split(" ")[0] || "there"},\n\n${email.preview}\n\nBest,\nAva`,
    lastOrder: "PETG 2.85mm • 1,200 kg",
    pastEmails: ["Follow-up on PETG pricing", "Sample pack offered on May 12"],
    openDeals: ["2 active deals", "Quote #FI-2041"],
    notes: "Prefers technical detail and MOQ clarity.",
    checks: [
      { label: "Missing merge fields", ok: false },
      { label: "Unsubscribe link present", ok: true },
      { label: "Contact not suppressed", ok: true },
      { label: "No recent email", ok: true },
    ],
  }));

  return <EmailsDashboard initialEmails={rows} />;
}
