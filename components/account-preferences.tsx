import { getViewer } from "@/lib/auth";
import { defaultUserPreferences } from "@/lib/user-preferences";
import { PreferencesProvider } from "./preferences-provider";
import { WorkspaceMemoryProvider } from "./workspace-memory";
import { TableColumnsProvider } from "./table-columns-provider";
import { defaultTableColumns } from "@/lib/table-column-preferences";

export async function AccountPreferences({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  return <WorkspaceMemoryProvider key={viewer?.id ?? "guest"}><PreferencesProvider initial={viewer?.preferences ?? defaultUserPreferences}><TableColumnsProvider initial={viewer?.tableColumns ?? defaultTableColumns}>{children}</TableColumnsProvider></PreferencesProvider></WorkspaceMemoryProvider>;
}
