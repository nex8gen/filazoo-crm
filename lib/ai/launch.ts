export const workspaceAiLaunchEvent = "filazoo:open-ai";
export type WorkspaceAiLaunchDetail = { mode: "chat" | "agent"; prompt?: string; submit?: boolean };

export function launchWorkspaceAi(detail: WorkspaceAiLaunchDetail) {
  window.dispatchEvent(new CustomEvent(workspaceAiLaunchEvent, { detail }));
}
