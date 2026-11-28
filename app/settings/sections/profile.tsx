import { Suspense } from "react";
import type { WorkspaceViewer } from "@/lib/auth";
import { profileAvatarUrl } from "@/lib/profile-avatar";
import { ChevronDown } from "lucide-react";
import { ProfilePhotoForm } from "../profile-photo-form";
import { ProfileForm } from "../settings-forms";
import { ProfileCreditUsage } from "../profile-credit-usage";

export function ProfileSection({ viewer }: { viewer: WorkspaceViewer }) {
  return <div className="profile-overview">
    <section className="settings-form-row settings-profile-row" aria-labelledby="settings-profile-title">
    <div className="settings-row-heading"><h2 id="settings-profile-title">Profile</h2><p>Your name and photo across the workspace.</p></div>
    <div className="settings-profile-details"><header className="profile-identity">
      <ProfilePhotoForm userId={viewer.id} name={viewer.displayName || "Account"} imageUrl={profileAvatarUrl(viewer.id, viewer.avatarPath)} preset={viewer.avatarPreset || "male"} />
      <div><h2 data-no-translate>{viewer.displayName || "Account"}</h2>
      {viewer.email ? <p data-no-translate>{viewer.email}</p> : null}</div>
    </header>
    <details className="profile-edit">
      <summary>Edit profile<ChevronDown aria-hidden="true" /></summary>
      <div className="profile-edit-content"><ProfileForm displayName={viewer.displayName || ""} /></div>
    </details>
    </div></section>
    <Suspense fallback={<section className="profile-credit-loading" aria-label="Loading credit usage" role="status"><span className="animate-pulse motion-reduce:animate-none">Loading credit usage…</span></section>}>
      <ProfileCreditUsage />
    </Suspense>
  </div>;
}
