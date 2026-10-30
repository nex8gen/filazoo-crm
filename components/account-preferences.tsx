import { getViewer } from "@/lib/auth";
import { defaultUserPreferences } from "@/lib/user-preferences";
import { PreferencesProvider } from "./preferences-provider";
import { WorkspaceMemoryProvider } from "./workspace-memory";

export async function AccountPreferences({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  return <WorkspaceMemoryProvider key={viewer?.id ?? "guest"}><PreferencesProvider initial={viewer?.preferences ?? defaultUserPreferences}>{children}</PreferencesProvider></WorkspaceMemoryProvider>;
}
