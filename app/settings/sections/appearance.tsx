import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppearanceSettings } from "../appearance-settings";
import { PreferencesForm } from "../preferences-form";

export function AppearanceSection() {
  return <div className="settings-content settings-section-enter settings-appearance">
    <Card className="shadow-none"><CardHeader><CardTitle>Color theme</CardTitle><CardDescription>Choose a theme or follow your device settings.</CardDescription></CardHeader><CardContent><AppearanceSettings /></CardContent></Card>
    <Card className="mb-4 max-w-2xl shadow-none"><CardHeader><CardTitle>Display and accessibility</CardTitle><CardDescription>Control table spacing and animation across your workspace.</CardDescription></CardHeader><CardContent><PreferencesForm section="appearance" /></CardContent></Card>
  </div>;
}
