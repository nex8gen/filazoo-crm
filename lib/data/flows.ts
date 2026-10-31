import "server-only";

import { requireWorkspaceMember } from "../auth.ts";
import { validateFlowResources } from "./flow-runtime.ts";
import { validateEmailFlowScope } from "./email-flows.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { flowInputSchema, isEmailScopedFlow, type FlowBulkAction, type FlowBulkResult, type AutomationFlow, type FlowInput, type FlowStep, type FlowStepType, type JsonConfig, type TriggerType, type FlowStatus } from "../flows.ts";

type FlowRow = {
  id: string;
  name: string;
  trigger_type: TriggerType;
  trigger_config: JsonConfig | null;
  status: FlowStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type StepRow = { id: string; flow_id: string; position: number; type: FlowStepType; config: JsonConfig | null };
type RunRow = { flow_id: string; status: string };

function mapFlows(rows: FlowRow[], steps: StepRow[], runs: RunRow[]): AutomationFlow[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    triggerType: row.trigger_type,
    triggerConfig: row.trigger_config ?? {},
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    activeRuns: runs.filter((run) => run.flow_id === row.id && run.status === "active").length,
    completedRuns: runs.filter((run) => run.flow_id === row.id && run.status === "done").length,
    steps: steps
      .filter((step) => step.flow_id === row.id)
      .sort((left, right) => left.position - right.position)
      .map((step): FlowStep => ({ id: step.id, position: step.position, type: step.type, config: step.config ?? {} })),
  }));
}

async function insertFlow(userId: string, input: FlowInput) {
  if (isEmailScopedFlow(input.triggerConfig)) input = { ...input, triggerConfig: await validateEmailFlowScope(input.triggerConfig) };
  if (input.status === "live") await validateFlowResources(userId, input);
  const { data, error } = await createSupabaseAdmin().rpc("save_automation_flow", { p_user_id: userId, p_flow_id: null, p_input: input });
  if (error) throw new Error(`Unable to create workflow: ${error.message}`);
  return data as string;
}

// Flows belong to this CRM workspace. Ownership supplies the mailbox/runtime
// identity; owners and workspace administrators can manage the definition.
export async function listWorkspaceFlows(): Promise<AutomationFlow[]> {
  await requireWorkspaceMember();
  return (await loadFlows()).filter((flow) => !isEmailScopedFlow(flow.triggerConfig));
}

export async function listFlows(userId: string): Promise<AutomationFlow[]> {
  return (await loadFlows(userId)).filter((flow) => !isEmailScopedFlow(flow.triggerConfig));
}

export async function listEmailFlows(scope: JsonConfig): Promise<AutomationFlow[]> {
  // Scoped flows are retrieved only from the email workspace.
  await validateEmailFlowScope(scope);
  return (await loadFlows(undefined, undefined, scope)).filter((flow) => flow.triggerConfig.flowScope === scope.flowScope
    && flow.triggerConfig.scopeCompanyId === scope.scopeCompanyId
    && flow.triggerConfig.scopeContactId === scope.scopeContactId);
}

async function loadFlowSteps(ids: string[]): Promise<StepRow[]> {
  const admin = createSupabaseAdmin();
  const steps: StepRow[] = [];
  // A bulk selection can exceed the Data API's per-request row limit. Never
  // save a partial definition back over a flow's existing steps.
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await admin.from("flow_steps").select("id,flow_id,position,type,config")
      .in("flow_id", ids).order("flow_id").order("position").range(offset, offset + 999);
    if (error) throw new Error(`Unable to load workflow steps: ${error.message}`);
    steps.push(...((data ?? []) as StepRow[]));
    if (!data || data.length < 1000) return steps;
  }
}

async function loadFlows(userId?: string, flowIds?: string[], scope?: JsonConfig): Promise<AutomationFlow[]> {
  const admin = createSupabaseAdmin();
  let query = admin.from("flows")
    .select("id,name,trigger_type,trigger_config,status,created_by,created_at,updated_at")
    .order("updated_at", { ascending: false });
  if (userId) query = query.eq("user_id", userId);
  if (flowIds) query = query.in("id", flowIds);
  if (scope) {
    query = query.eq("trigger_config->>flowScope", scope.flowScope).eq("trigger_config->>scopeCompanyId", scope.scopeCompanyId);
    if (scope.flowScope === "email") query = query.eq("trigger_config->>scopeContactId", scope.scopeContactId);
  }
  const { data: rows, error } = await query;
  if (error) throw new Error(`Unable to load workflows: ${error.message}`);
  const ids = (rows ?? []).map((row) => row.id);
  if (!ids.length) return [];
  const [steps, { data: runs, error: runError }] = await Promise.all([
    loadFlowSteps(ids),
    admin.from("flow_runs").select("flow_id,status").in("flow_id", ids),
  ]);
  if (runError) throw new Error(`Unable to load workflow runs: ${runError.message}`);
  return mapFlows((rows ?? []) as FlowRow[], steps, (runs ?? []) as RunRow[]);
}

export async function createFlow(userId: string, input: FlowInput) {
  const id = await insertFlow(userId, input);
  return (await loadFlows(userId, [id]))[0]!;
}

async function requireFlowManager(userId: string) {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager"]);
  if (viewer.id !== userId) throw new Error("Access denied.");
  return viewer;
}

export async function updateFlow(userId: string, flowId: string, input: FlowInput) {
  const viewer = await requireFlowManager(userId);
  const admin = createSupabaseAdmin();
  let query = admin.from("flows").select("user_id,trigger_config").eq("id", flowId);
  if (viewer.role !== "admin") query = query.eq("user_id", viewer.id);
  const { data: flow, error: lookupError } = await query.maybeSingle();
  if (lookupError) throw new Error(`Unable to load workflow: ${lookupError.message}`);
  if (!flow) throw new Error("Workflow not found.");
  const previous = (flow.trigger_config ?? {}) as JsonConfig;
  if (isEmailScopedFlow(previous) && ["flowScope", "scopeCompanyId", "scopeContactId"].some((key) => previous[key] !== input.triggerConfig[key])) {
    throw new Error("An email workflow must keep its original email or company scope.");
  }
  if (isEmailScopedFlow(input.triggerConfig)) input = { ...input, triggerConfig: await validateEmailFlowScope(input.triggerConfig) };
  // Authorize the actor above, then save using the existing owner identity so
  // admin edits retain the original sender, notifications, and runtime scope.
  const ownerId = flow.user_id as string;
  if (input.status === "live") await validateFlowResources(ownerId, input);
  const { error } = await admin.rpc("save_automation_flow", { p_user_id: ownerId, p_flow_id: flowId, p_input: input });
  if (error) throw new Error(error.message);
  return (await loadFlows(ownerId, [flowId]))[0]!;
}

export async function deleteFlow(userId: string, flowId: string) {
  const viewer = await requireFlowManager(userId);
  let query = createSupabaseAdmin().from("flows").delete().eq("id", flowId);
  if (viewer.role !== "admin") query = query.eq("user_id", viewer.id);
  const { data, error } = await query.select("id").maybeSingle();
  if (error) throw new Error(`Unable to delete workflow: ${error.message}`);
  if (!data) throw new Error("Workflow not found.");
}

export async function bulkUpdateFlows(userId: string, ids: string[], action: FlowBulkAction): Promise<FlowBulkResult[]> {
  const viewer = await requireFlowManager(userId);
  const uniqueIds = [...new Set(ids)];
  // Use current saved definitions, rather than overwriting newer edits with
  // definitions from the browser's list. Each write rechecks permissions.
  const flows = action === "delete" ? [] : await loadFlows(viewer.role === "admin" ? undefined : viewer.id, uniqueIds);
  const byId = new Map(flows.map((flow) => [flow.id, flow]));
  const results: FlowBulkResult[] = [];
  // Bound concurrency so large selections finish without flooding the database.
  for (let offset = 0; offset < uniqueIds.length; offset += 5) {
    const batch = await Promise.all(uniqueIds.slice(offset, offset + 5).map(async (id): Promise<FlowBulkResult> => {
      try {
        if (action === "delete") {
          await deleteFlow(userId, id);
          return { id, ok: true };
        }
        const flow = byId.get(id);
        if (!flow) throw new Error("Workflow not found.");
        const parsed = flowInputSchema.safeParse({ ...flow, status: action });
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "Invalid workflow.");
        return { id, ok: true, flow: await updateFlow(userId, id, parsed.data) };
      } catch (error) {
        return { id, ok: false, error: error instanceof Error ? error.message : "Unable to update workflow." };
      }
    }));
    results.push(...batch);
  }
  return results;
}

export type FlowMemberOption = { id: string; label: string };

export async function listFlowMemberOptions(): Promise<FlowMemberOption[]> {
  const admin = createSupabaseAdmin();
  const [{ data: members, error }, { data: users }] = await Promise.all([
    admin.from("workspace_members").select("user_id,display_name").not("activated_at", "is", null).order("display_name"),
    admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
  ]);
  if (error) throw new Error(`Unable to load workspace members: ${error.message}`);
  const emails = new Map((users?.users ?? []).map((user) => [user.id, user.email ?? ""]));
  return (members ?? []).map((member) => ({
    id: member.user_id,
    label: member.display_name || emails.get(member.user_id) || "Workspace member",
  }));
}

export type FlowFilterOptions = { segments: string[]; countries: string[] };

export async function listFlowFilterOptions(): Promise<FlowFilterOptions> {
  const data: Array<{ segment: string | null; country: string | null }> = [];
  const admin = createSupabaseAdmin();
  for (let offset = 0; ; offset += 1000) {
    const { data: batch, error } = await admin.from("companies").select("segment,country").order("id").range(offset, offset + 999);
    if (error) throw new Error(`Unable to load company filters: ${error.message}`);
    data.push(...(batch ?? []));
    if (!batch || batch.length < 1000) break;
  }
  const unique = (values: Array<string | null>) => [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
  return { segments: unique((data ?? []).map((row) => row.segment)), countries: unique((data ?? []).map((row) => row.country)) };
}
