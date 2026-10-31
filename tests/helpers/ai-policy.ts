import * as policy from "../../lib/ai-policy.ts";

// Existing feature fixtures explicitly opt in to automatic actions. Policy denial
// and review are exercised separately against the real guards in ai-policy.test.ts.
export function policyTestDependency(name: string) {
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
