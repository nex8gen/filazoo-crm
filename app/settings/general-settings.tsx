import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PreferencesForm } from "./preferences-form";
import { SettingsLanguage } from "./settings-language";

export function GeneralSettings() {
  return <div className="settings-content settings-section-enter space-y-5">
    <Card className="shadow-none"><CardHeader><CardTitle>Language</CardTitle><CardDescription>Choose English or Chinese for this browser.</CardDescription></CardHeader><CardContent><SettingsLanguage /></CardContent></Card>
    <Card className="shadow-none"><CardHeader><CardTitle>Navigation and lists</CardTitle><CardDescription>Choose where you start after signing in and how many records appear in lists.</CardDescription></CardHeader><CardContent><PreferencesForm section="general" /></CardContent></Card>
  </div>;
}
