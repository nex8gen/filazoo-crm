import "server-only";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import type { WorkspaceViewer } from "../auth.ts";
import { type FlowEditorSave } from "../flow-editor-draft.ts";
import { withFlowEmailIdentities, flowInputSchema, isEmailScopedFlow, type JsonConfig } from "../flows.ts";
import { validateFlowResources, validateFlowSenderAccess } from "./flow-runtime.ts";
import { workflowErrorMessage } from "../flow-execution-errors.ts";
import { validateEmailFlowScope } from "./email-flows.ts";
import { getFlowEditingResult } from "./flows.ts";

export async function saveFlowEditingCopy(viewer: WorkspaceViewer, input: FlowEditorSave) {
  if (!["admin", "operator", "bd_manager"].includes(viewer.role)) throw new Error("Access denied.");
  input = { ...input, flow: withFlowEmailIdentities(input.flow) };
  const db = createSupabaseAdmin();
  let ownerId = viewer.id;
  if (!input.create) {
    let query = db.from("flows").select("user_id,trigger_config").eq("id", input.flowId);
    if (viewer.role !== "admin") query = query.eq("user_id", viewer.id);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error("Unable to load workflow.");
    if (!data) throw new Error("Workflow not found.");
    ownerId = data.user_id;
    const scope = (data.trigger_config ?? {}) as JsonConfig;
    if (isEmailScopedFlow(scope) && ["flowScope", "scopeCompanyId", "scopeContactId"].some(key => scope[key] !== input.flow.triggerConfig[key])) throw new Error("An email workflow must keep its original scope.");
  }
  if (isEmailScopedFlow(input.flow.triggerConfig)) await validateEmailFlowScope(input.flow.triggerConfig);
  const { error } = await db.rpc("save_flow_editor_draft", { p_user_id: ownerId, p_flow_id: input.flowId, p_create: input.create, p_revision: input.revision, p_base_updated_at: input.baseUpdatedAt, p_input: input.flow });
  if (error) {
    if (error.code === "40001") throw new Error("Workflow changed. Reload before saving.");
    throw new Error("Unable to save workflow changes automatically. Please retry.");
  }
  const saved = await getFlowEditingResult(ownerId, input.flowId);
  if (!saved.editorDraft || saved.editorDraft.revision !== input.revision + 1) throw new Error("Workflow changed. Reload before saving.");
  const ready = flowInputSchema.safeParse({ ...input.flow, status: saved.status });
  if (ready.success) {
    try {
      await validateFlowSenderAccess(viewer.id, ready.data, ownerId);
      if (saved.status === "live") await validateFlowResources(ownerId, ready.data);
      const { error: publicationError } = await db.rpc("publish_flow_editor_draft", { p_user_id: ownerId, p_flow_id: input.flowId, p_revision: saved.editorDraft!.revision, p_input: ready.data });
      if (publicationError) throw new Error(publicationError.code === "40001" ? "Workflow changed. Reload before saving." : "Live workflow could not be updated.");
      return getFlowEditingResult(ownerId, input.flowId);
    } catch (cause) {
      const message = workflowErrorMessage(cause);
      await db.from("flow_editor_drafts").update({ publication_error: message }).eq("flow_id", input.flowId).eq("revision", saved.editorDraft!.revision).throwOnError();
      saved.editorDraft!.publicationError = message;
    }
  }
  return saved;
}
