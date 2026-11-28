/** Only expose known, actionable plan errors; never return raw database details. */
export function teamInvitationError(error: { message?: string }) {
  const message = error.message ?? "";
  if (message.includes("no available user places") || message.includes("subscription member limit")) {
    return "Your plan has no available user places. The owner and pending invitations count toward the limit. Revoke a pending invitation or choose a plan with more included users.";
  }
  if (message.includes("active subscription is required")) return "An active subscription is required to add team members. Ask the workspace owner to review the plan.";
  if (message.includes("already a workspace member")) return "This person is already a workspace member.";
  return null;
}
