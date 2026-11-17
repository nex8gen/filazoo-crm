type SendingEnvironment = { FLOW_DRY_RUN?: string; DRY_RUN?: string; NODE_ENV?: string; VERCEL_ENV?: string };

/** Customer workflows send normally. Only provider-controlled tests simulate delivery. */
export function workflowDryRun(environment: SendingEnvironment): boolean {
  if (environment.FLOW_DRY_RUN !== undefined) return environment.FLOW_DRY_RUN !== "false";
  return environment.NODE_ENV === "test" || environment.VERCEL_ENV === "preview";
}
