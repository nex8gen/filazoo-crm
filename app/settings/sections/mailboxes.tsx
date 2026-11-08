import { redirect } from "next/navigation";
import type { WorkspaceViewer } from "@/lib/auth";

export async function MailboxesSection({ viewer }: { viewer: WorkspaceViewer }) {
  void viewer;
  redirect("/settings/apps?view=personal");
}
