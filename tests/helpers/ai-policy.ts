import * as policy from "../../lib/ai-policy.ts";
import * as researchRequest from "../../lib/ai/research-request.ts";
import * as requestContext from "../../lib/ai/request-context.ts";
import * as researchProgress from "../../lib/ai/research-progress.ts";
import * as providerError from "../../lib/ai/assistant-provider-error.ts";
import { withWorkspaceViewer } from "../../lib/workspace-context.ts";
import * as credentials from "../../lib/ai/provider-credentials.ts";
import * as recordPresentation from "../../lib/ai/record-presentation.ts";
import * as sessionResponse from "../../lib/workspace-session-response.ts";

// Existing feature fixtures explicitly opt in to automatic actions. Policy denial
// and review are exercised separately against the real guards in ai-policy.test.ts.
export function policyTestDependency(name: string) {
  if (name === "@/lib/workspace-session-response") return sessionResponse;
  if (name === "@/lib/ai/record-presentation") return recordPresentation;
  if (name === "@/lib/ai/research-progress") return researchProgress;
  if (name === "@/lib/ai/request-context") return requestContext;
  if (name === "@/lib/ai/research-request") return researchRequest;
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
