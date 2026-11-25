export const AI_CREDITS_CHANGED = "ai-credits-changed";

export function notifyAiCreditsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new window.Event(AI_CREDITS_CHANGED));
}
