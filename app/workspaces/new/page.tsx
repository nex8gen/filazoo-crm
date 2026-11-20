import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/auth";

export const metadata = { title: "Create workspace" };
export const instant = false;
export default async function NewWorkspacePage() {
  await requireViewer();
  redirect("/subscribe?new=1");
}
