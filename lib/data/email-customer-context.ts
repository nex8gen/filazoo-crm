import type { WorkspaceViewer } from "../auth.ts";
import type { InboxEmailItem } from "../email-inbox.ts";
import { canViewEmail } from "../email-access.ts";
import { emailCustomerContext } from "../email-customer-context.ts";
import { getViewerMailbox } from "./mailboxes.ts";
import { getAssignedEmailContacts } from "./email-access.ts";
import { listInboxCompanies } from "./inbox-companies.ts";

/** Resolve the selected correspondent independently of the full-history read budget. */
export async function readEmailCustomerContext(viewer: WorkspaceViewer, mailboxId: string, email: string, signal?: AbortSignal) {
  email = email.trim().toLowerCase();
  const mailbox = await getViewerMailbox(viewer.id, mailboxId);
  if (!mailbox) return null;
  const assigned = await getAssignedEmailContacts(viewer);
  if (!canViewEmail(viewer, email, assigned, mailbox)) return null;
  const result = await listInboxCompanies([{ id: `customer:${email}`, contact: email, company: "Unknown company" } as InboxEmailItem], assigned, signal);
  const company = result.companies.find(company => company.email.trim().toLowerCase() === email);
  return emailCustomerContext(company);
}
