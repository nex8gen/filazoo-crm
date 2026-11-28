"use client";
import { NotificationToast } from "@/components/ui/notification-toast";

import { useActionState } from "react";
import { authButtonClass } from "@/components/auth-fields";
import { joinWorkspace } from "./actions";

export function JoinWorkspaceForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(async (previous: Awaited<ReturnType<typeof joinWorkspace>> | undefined, data: FormData) => {
    const result = await joinWorkspace(previous, data);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Clear retained workspace state after membership changes.
    if (result.success) window.location.assign("/");
    return result;
  }, undefined);
  return <form action={action} className="space-y-4" aria-busy={pending}><input type="hidden" name="token" value={token} />{state?.error ? <NotificationToast>{state.error}</NotificationToast> : null}<button className={authButtonClass} type="submit" disabled={pending}>{pending ? "Joining…" : "Join workspace"}</button></form>;
}
