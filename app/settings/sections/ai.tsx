import type { WorkspaceViewer } from "@/lib/auth";
import { getAiSettings } from "@/lib/data/ai-settings";
import { withWorkspaceViewer } from "@/lib/workspace-context";
import { AiSettingsForm } from "../ai-settings-form";
import { Suspense } from "react";
import { getAiUsageSettings } from "@/lib/data/ai-usage-settings";
import { AiUsageSettingsForm } from "../ai-usage-settings-form";

async function UsageLimits({ viewer }: { viewer: WorkspaceViewer }) {
  const result = await withWorkspaceViewer(viewer, () => getAiUsageSettings(viewer.id).then(data => ({ data, error: "" })).catch(() => ({ data: null, error: "AI usage controls are unavailable. Refresh or ask your administrator to check the usage configuration." })));
  return result.data ? <AiUsageSettingsForm initial={result.data} viewerId={viewer.id} /> : <p role="alert">{result.error}</p>;
}

export async function AiSection({ viewer }: { viewer: WorkspaceViewer }) {
  const settings = await withWorkspaceViewer(viewer, () => getAiSettings());
  return <div className="settings-content settings-section-enter !max-w-3xl space-y-5">
    {viewer.role === "admin" ? <nav aria-label="AI settings sections" className="flex flex-wrap gap-4 text-sm"><a href="#ai-policy" className="text-primary underline underline-offset-4">Access and behavior</a><a href="#ai-usage-controls" className="text-primary underline underline-offset-4">Usage and spending limits</a></nav> : null}
    <section id="ai-policy" aria-label="AI access and behavior"><AiSettingsForm initial={settings} canManage={viewer.role === "admin"} /></section>
    {viewer.role === "admin" ? <Suspense fallback={<p role="status">Loading AI usage limits…</p>}><UsageLimits viewer={viewer} /></Suspense> : null}
  </div>;
}
