import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PreferencesForm } from "../preferences-form";

export function EmailSection() {
  return <div className="settings-content settings-section-enter space-y-4"><Card className="max-w-2xl shadow-none"><CardHeader><CardTitle>Reading and sending</CardTitle><CardDescription>Your defaults for the email inbox and company conversations.</CardDescription></CardHeader><CardContent><PreferencesForm section="email" /><Separator className="my-5" /><Button variant="outline" nativeButton={false} render={<Link href="/settings/apps?view=personal" />}>Manage email connections</Button></CardContent></Card></div>;
}
