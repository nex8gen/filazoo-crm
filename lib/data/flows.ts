import "server-only";

import { createSupabaseAdmin } from "../supabase/admin.ts";
import { defaultFlowInput, type AutomationFlow, type FlowInput, type FlowStep, type FlowStepType, type JsonConfig, type TriggerType, type FlowStatus } from "../flows.ts";

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
  const admin = createSupabaseAdmin();
  const { data: flow, error } = await admin.from("flows").insert({
    user_id: userId,
    name: input.name,
    trigger_type: input.triggerType,
    trigger_config: input.triggerConfig,
    status: input.status,
    created_by: userId,
  }).select("id").single();
  if (error || !flow) throw new Error(`Unable to create flow: ${error?.message || "No flow returned."}`);

  const { error: stepError } = await admin.from("flow_steps").insert(input.steps.map((step, position) => ({
    flow_id: flow.id,
    position,
    type: step.type,
    config: step.config,
  })));
  if (stepError) {
    await admin.from("flows").delete().eq("id", flow.id).eq("user_id", userId);
    throw new Error(`Unable to create flow steps: ${stepError.message}`);
  }
  return flow.id as string;
}

async function ensureDefaultFlow(userId: string) {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin.from("flows").select("id").eq("user_id", userId).limit(1);
  if (error) throw new Error(`Unable to load flows: ${error.message}`);
  if (!data?.length) await insertFlow(userId, defaultFlowInput);
}

export async function listFlows(userId: string): Promise<AutomationFlow[]> {
  await ensureDefaultFlow(userId);
  const admin = createSupabaseAdmin();
  const { data: rows, error } = await admin.from("flows")
    .select("id,name,trigger_type,trigger_config,status,created_by,created_at,updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Unable to load flows: ${error.message}`);
  const ids = (rows ?? []).map((row) => row.id);
  if (!ids.length) return [];
  const [{ data: steps, error: stepError }, { data: runs, error: runError }] = await Promise.all([
    admin.from("flow_steps").select("id,flow_id,position,type,config").in("flow_id", ids).order("position"),
    admin.from("flow_runs").select("flow_id,status").in("flow_id", ids),
  ]);
  if (stepError) throw new Error(`Unable to load flow steps: ${stepError.message}`);
  if (runError) throw new Error(`Unable to load flow runs: ${runError.message}`);
  return mapFlows((rows ?? []) as FlowRow[], (steps ?? []) as StepRow[], (runs ?? []) as RunRow[]);
}

export async function createFlow(userId: string, input: FlowInput) {
  const id = await insertFlow(userId, input);
  return (await listFlows(userId)).find((flow) => flow.id === id)!;
}

export async function updateFlow(userId: string, flowId: string, input: FlowInput) {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin.from("flows").update({
    name: input.name,
    trigger_type: input.triggerType,
    trigger_config: input.triggerConfig,
    status: input.status,
    updated_at: new Date().toISOString(),
  }).eq("id", flowId).eq("user_id", userId).select("id").maybeSingle();
  if (error) throw new Error(`Unable to update flow: ${error.message}`);
  if (!data) throw new Error("Flow not found.");

  const { error: deleteError } = await admin.from("flow_steps").delete().eq("flow_id", flowId);
  if (deleteError) throw new Error(`Unable to replace flow steps: ${deleteError.message}`);
  const { error: insertError } = await admin.from("flow_steps").insert(input.steps.map((step, position) => ({
    flow_id: flowId,
    position,
    type: step.type,
    config: step.config,
  })));
  if (insertError) throw new Error(`Unable to save flow steps: ${insertError.message}`);
  return (await listFlows(userId)).find((flow) => flow.id === flowId)!;
}

export async function deleteFlow(userId: string, flowId: string) {
  const { data, error } = await createSupabaseAdmin().from("flows").delete().eq("id", flowId).eq("user_id", userId).select("id").maybeSingle();
  if (error) throw new Error(`Unable to delete flow: ${error.message}`);
  if (!data) throw new Error("Flow not found.");
}

export type FlowMemberOption = { id: string; label: string };

export async function listFlowMemberOptions(): Promise<FlowMemberOption[]> {
  const admin = createSupabaseAdmin();
  const [{ data: members, error }, { data: users }] = await Promise.all([
    admin.from("workspace_members").select("user_id,display_name").order("display_name"),
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
  const { data, error } = await createSupabaseAdmin().from("companies").select("segment,country").limit(1000);
  if (error) throw new Error(`Unable to load company filters: ${error.message}`);
  const unique = (values: Array<string | null>) => [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
  return { segments: unique((data ?? []).map((row) => row.segment)), countries: unique((data ?? []).map((row) => row.country)) };
}
