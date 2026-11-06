import * as policy from "../../lib/ai-policy.ts";
import * as providerError from "../../lib/ai/assistant-provider-error.ts";
import { withWorkspaceViewer } from "../../lib/workspace-context.ts";
import * as credentials from "../../lib/ai/provider-credentials.ts";

// Existing feature fixtures explicitly opt in to automatic actions. Policy denial
// and review are exercised separately against the real guards in ai-policy.test.ts.
export function policyTestDependency(name: string) {
  if (/(?:^|\/)ai\/provider-credentials(?:\.ts)?$/.test(name)) return credentials;
  if (name === "@/lib/workspace-context") return { withWorkspaceViewer: (viewer: { id: string; workspaceId?: string }, work: () => unknown) => withWorkspaceViewer({ ...viewer, workspaceId: viewer.workspaceId ?? "legacy" }, work) };
  if (name === "@/lib/ai/assistant-provider-error") return providerError;
  if (/^(?:@\/lib\/|\.\.\/|\.\/)(?:ai-policy)(?:\.ts)?$/.test(name)) return policy;
  if (/^(?:@\/lib\/data\/|\.\.\/data\/|\.\/)(?:ai-settings)(?:\.ts)?$/.test(name)) {
    const allowed = policy.defaultAiPolicy();
    for (const key of Object.keys(allowed.actions) as policy.AiAction[]) allowed.actions[key] = "auto";
    return {
      getAiSettings: async () => ({ policy: allowed, revision: 1, updatedAt: null }),
      requireAiFeature: async () => allowed,
      requireAiData: async () => allowed,
      requireAiAutomation: async () => allowed,
    };
  }
  return undefined;
}
