import type { WorkspaceViewer } from "./auth.ts";

export type AssignedEmailContacts = Map<string, string> | null;

export function canViewEmail(
  viewer: Pick<WorkspaceViewer, "role">,
  contact: string,
  assignedContacts: AssignedEmailContacts,
) {
  return viewer.role !== "bd_manager"
    || Boolean(assignedContacts?.has(contact.trim().toLowerCase()));
}
