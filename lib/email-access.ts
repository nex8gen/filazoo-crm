import type { WorkspaceViewer } from "./auth.ts";
import type { NormalizedMailboxRecord } from "./mailbox-utils.ts";

export type AssignedEmailContacts = Map<string, string> | null;

export function canViewEmail(
  viewer: Pick<WorkspaceViewer, "role"> & Partial<Pick<WorkspaceViewer, "id">>,
  contact: string,
  assignedContacts: AssignedEmailContacts,
  mailbox?: Pick<NormalizedMailboxRecord, "type" | "userId"> | null,
) {
  // Personal accounts belong to their owner regardless of CRM assignments.
  if (mailbox?.type === "personal") return Boolean(viewer.id && mailbox.userId === viewer.id);
  return viewer.role !== "bd_manager"
    || Boolean(assignedContacts?.has(contact.trim().toLowerCase()));
}
