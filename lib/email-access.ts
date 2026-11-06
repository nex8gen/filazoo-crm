import type { WorkspaceViewer } from "./auth.ts";
import type { NormalizedMailboxRecord } from "./mailbox-utils.ts";

export type AssignedEmailContacts = Map<string, string> | null;

export function canViewEmail(
  viewer: Pick<WorkspaceViewer, "role"> & Partial<Pick<WorkspaceViewer, "id">>,
  contact: string,
  assignedContacts: AssignedEmailContacts,
  mailbox?: Pick<NormalizedMailboxRecord, "type" | "userId"> | null,
  allowedPersonalContacts?: ReadonlySet<string>,
) {
  // Authorized company history may read only its exact saved contacts across
  // staff accounts. Other personal messages remain private.
  if (mailbox?.type === "personal") return Boolean((viewer.id && mailbox.userId === viewer.id)
    || allowedPersonalContacts?.has(contact.trim().toLowerCase()));
  return viewer.role !== "bd_manager"
    || Boolean(assignedContacts?.has(contact.trim().toLowerCase()));
}
