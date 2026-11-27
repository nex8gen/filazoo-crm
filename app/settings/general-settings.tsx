import type { WorkspaceViewer } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PreferencesForm } from "./preferences-form";
import { SettingsLanguage } from "./settings-language";
import { AppearanceSection } from "./sections/appearance";
import { ProfileSection } from "./sections/profile";

export function GeneralSettings({ viewer }: { viewer: WorkspaceViewer }) {
  return <div className="settings-content settings-section-enter space-y-5">
    <section id="profile" aria-label="Profile"><ProfileSection viewer={viewer} /></section>
    <Card className="shadow-none"><CardHeader><CardTitle>Language</CardTitle><CardDescription>Choose English or Chinese for this browser.</CardDescription></CardHeader><CardContent><SettingsLanguage /></CardContent></Card>
    <Card className="shadow-none"><CardHeader><CardTitle>Lists</CardTitle></CardHeader><CardContent><PreferencesForm section="general" /></CardContent></Card>
    <section id="appearance" aria-label="Appearance"><AppearanceSection /></section>
  </div>;
}
