import type { WorkspaceViewer } from "@/lib/auth";
import { profileAvatarUrl } from "@/lib/profile-avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ProfilePhotoForm } from "../profile-photo-form";
import { ProfileForm } from "../settings-forms";
import { getAuthProviders } from "@/lib/auth-providers";
import { createClient } from "@/lib/supabase/server";
import { AlipayConnection } from "../alipay-connection";

export async function ProfileSection({ viewer }: { viewer: WorkspaceViewer }) {
  const [providers, { data: { user } }] = await Promise.all([getAuthProviders(), (await createClient()).auth.getUser()]);
  return <div className="settings-content settings-section-enter space-y-4"><Card className="max-w-2xl shadow-none"><CardHeader><CardTitle className="text-sm">Profile</CardTitle><CardDescription className="text-xs">This name appears throughout the Filazoo workspace.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-1"><span className="text-xs text-muted-foreground">Email</span><span className="text-sm">{viewer.email}</span></div><Separator /><ProfilePhotoForm userId={viewer.id} name={viewer.displayName || "Account"} imageUrl={profileAvatarUrl(viewer.id, viewer.avatarPath)} preset={viewer.avatarPreset || "male"} /><Separator /><ProfileForm displayName={viewer.displayName || ""} /><Separator /><AlipayConnection enabled={providers.includes("alipay")} connected={Boolean(user?.identities?.some(identity => identity.provider === "custom:alipay"))} /></CardContent></Card></div>;
}
