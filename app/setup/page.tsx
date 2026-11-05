import { redirect } from "next/navigation";

// Workspace customers configure their team and connections in the app. Platform
// deployment credentials and infrastructure instructions belong in repo docs.
export default function SetupPage() {
  redirect("/workspaces/setup");
}
