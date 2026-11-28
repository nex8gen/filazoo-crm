import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppearanceSettings } from "../appearance-settings";
import { PreferencesForm } from "../preferences-form";

export function AppearanceSection() {
  return <div className="settings-content settings-section-enter settings-appearance">
    <Card className="shadow-none"><CardHeader><CardTitle>Color theme</CardTitle></CardHeader><CardContent><AppearanceSettings /></CardContent></Card>
    <Card className="mb-4 max-w-2xl shadow-none"><CardHeader><CardTitle>Display and accessibility</CardTitle></CardHeader><CardContent><PreferencesForm section="appearance" /></CardContent></Card>
  </div>;
}
