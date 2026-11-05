const standaloneRoots = [
  "/customer", "/login", "/signup", "/workspaces", "/join",
  "/forgot-password", "/accept-invitation", "/update-password",
  "/auth", "/access-denied", "/privacy", "/terms", "/data-deletion",
];

/** Auth and onboarding routes never render the CRM sidebar or workspace tools. */
export function isStandaloneRoute(pathname: string) {
  return standaloneRoots.some(root => pathname === root || pathname.startsWith(`${root}/`));
}
