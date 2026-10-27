import { getViewer } from "@/lib/auth";
import { defaultUserPreferences } from "@/lib/user-preferences";
import { PreferencesProvider } from "./preferences-provider";

export async function AccountPreferences({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  return <PreferencesProvider key={viewer?.id ?? "guest"} initial={viewer?.preferences ?? defaultUserPreferences}>{children}</PreferencesProvider>;
}
