import type { WorkspaceViewer } from "@/lib/auth";
import { profileAvatarUrl } from "@/lib/profile-avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ProfilePhotoForm } from "../profile-photo-form";
import { ProfileForm } from "../settings-forms";

export function ProfileSection({ viewer }: { viewer: WorkspaceViewer }) {
  return <div className="settings-content settings-section-enter space-y-4"><Card className="shadow-none"><CardHeader><CardTitle>Profile details</CardTitle><CardDescription>Your name and photo appear throughout the workspace.</CardDescription></CardHeader><CardContent className="space-y-5"><div className="grid gap-1"><span className="text-xs text-muted-foreground">Sign-in email</span><span data-no-translate className="break-all text-sm">{viewer.email}</span></div><Separator /><ProfilePhotoForm userId={viewer.id} name={viewer.displayName || "Account"} imageUrl={profileAvatarUrl(viewer.id, viewer.avatarPath)} preset={viewer.avatarPreset || "male"} /><Separator /><ProfileForm displayName={viewer.displayName || ""} /></CardContent></Card></div>;
}
