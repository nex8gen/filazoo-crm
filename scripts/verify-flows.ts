// Run explicitly: node --env-file=.env.local --conditions=react-server --experimental-strip-types scripts/verify-flows.ts
// Uses disposable records; email execution is forced to dry-run.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.DRY_RUN = "true";
const { createSupabaseAdmin } = await import("../lib/supabase/admin.ts");
const { enrollMatchingFlows, processFlowRun, loadFlowFacts, validateFlowResources, scanTimeBasedFlowTriggers } = await import("../lib/data/flow-runtime.ts");
const { createServerClient } = await import("@supabase/ssr");
const { signTracking } = await import("../lib/flow-tracking.ts");
const admin = createSupabaseAdmin();
const prefix = `Automation verification ${randomUUID()}`;
const { data: member } = await admin.from("workspace_members").select("user_id").eq("role", "admin").not("activated_at", "is", null).limit(1).single().throwOnError();
const userId = member!.user_id;
let companyId: string | undefined;
const flowIds: string[] = [];
const stateKeys: string[] = [];
const runIds: string[] = [];
const checks: string[] = [];
const pass = (message: string) => { checks.push(message); console.log(`PASS ${message}`); };
async function save(steps: Array<{ type: string; config: Record<string, unknown> }>, id?: string, status = "live") {
  const { data } = await admin.rpc("save_automation_flow", { p_user_id: userId, p_flow_id: id ?? null, p_input: { name: prefix, triggerType: "company_segment_changed", triggerConfig: { segment: prefix }, status, steps } }).throwOnError();
  if (!id) flowIds.push(data);
  return data as string;
}
async function forceDue(id: string) {
  await admin.from("flow_runs").update({ next_run_at: new Date(Date.now() - 1000).toISOString() }).eq("id", id).throwOnError();
}
try {
  const { data: company } = await admin.from("companies").insert({ name: prefix, segment: prefix, country: "US", status: "qualified" }).select("id").single().throwOnError();
  companyId = company!.id;
  const { data: contact } = await admin.from("contacts").insert({ company_id: companyId, name: "Automation Test", email: `${randomUUID()}@example.com`, verification_status: "valid" }).select("id").single().throwOnError();
  const contactId = contact!.id;
  await admin.from("pipeline").insert({ company_id: companyId, owner_id: userId, stage: "interested" }).throwOnError();
  const id = await save([
    { type: "wait", config: { amount: 1, unit: "minutes" } },
    { type: "change_category", config: { category: "Interested", reason: "Test category" } },
    { type: "if_condition", config: { field: "category_is", category: "Interested", action: "skip_next", unmatchedAction: "stop_flow" } },
    { type: "create_task", config: { assigneeType: "owner", title: "Must be skipped", dueInDays: 0 } },
    { type: "create_task", config: { assigneeType: "user", assigneeId: userId, title: prefix, notes: "Verified notes", priority: "high", dueInDays: 2 } },
    { type: "internal_alert", config: { userId: "owner", channel: "in_app", message: prefix, includeThreadLink: true } },
    { type: "stop", config: { outcome: "cancelled", reason: "Verified cancellation" } },
    { type: "create_task", config: { assigneeType: "owner", title: "Must never run", dueInDays: 0 } },
  ]);
  const key = `verify:${randomUUID()}`;
  stateKeys.push(key);
  const event = { type: "company_segment_changed" as const, flowId: id, conversationId: key, messageKey: key, companyId, contactId, segment: prefix, eventKey: key };
  const enrolled = await enrollMatchingFlows(event);
  assert.equal(enrolled[0]?.reason, "waiting");
  const runId = enrolled[0]!.runId!;
  runIds.push(runId);
  assert.equal((await processFlowRun(runId)).processed, 0);
  pass("CRM segment enrollment persists a wait and does not execute before it is due");
  assert.equal((await enrollMatchingFlows(event))[0]?.enrolled, false);
  assert.equal((await enrollMatchingFlows({ ...event, eventKey: randomUUID() }))[0]?.enrolled, false);
  pass("event retries and concurrent active conversation enrollment are deduplicated");
  // Existing waiting runs keep the definition they enrolled with.
  await save([{ type: "stop", config: { reason: "New definition", outcome: "completed" } }], id);
  await forceDue(runId);
  const concurrent = await Promise.all([processFlowRun(runId), processFlowRun(runId)]);
  assert.equal(concurrent.filter((result) => result.status === "cancelled").length, 1);
  const { data: tasks } = await admin.from("crm_tasks").select("title,notes,priority,assigned_to,due_at").eq("flow_run_id", runId).throwOnError();
  assert.equal(tasks!.length, 1);
  assert.equal(tasks![0].title, prefix);
  assert.equal(tasks![0].notes, "Verified notes");
  assert.equal(tasks![0].priority, "high");
  assert.equal(tasks![0].assigned_to, userId);
  assert.ok(Date.parse(tasks![0].due_at) > Date.now() + 86400000);
  const { data: notifications } = await admin.from("internal_notifications").select("user_id,message,include_thread_link").eq("flow_run_id", runId).throwOnError();
  assert.equal(notifications!.length, 1);
  assert.equal(notifications![0].user_id, userId);
  assert.equal(notifications![0].include_thread_link, true);
  pass("wait resumes, category condition skips, task settings persist, owner alert is created, and stop cancels later steps exactly once");
  pass("editing a saved flow preserves the steps of an already enrolled run");
  const { error: invalidSave } = await admin.rpc("save_automation_flow", { p_user_id: userId, p_flow_id: id, p_input: { name: "Invalid edit", triggerType: "company_segment_changed", triggerConfig: { segment: prefix }, status: "live", steps: [{ type: "invalid", config: {} }] } });
  assert.ok(invalidSave);
  const { data: preserved } = await admin.from("flow_steps").select("type").eq("flow_id", id).throwOnError();
  assert.deepEqual(preserved!.map((step) => step.type), ["stop"]);
  pass("invalid database saves roll back the whole flow definition");
  const repeat = await enrollMatchingFlows({ ...event, eventKey: randomUUID() });
  assert.equal(repeat[0]?.enrolled, true);
  runIds.push(repeat[0]!.runId!);
  pass("a fresh CRM event can re-enroll a completed conversation");

  const thread = `verify-thread:${randomUUID()}`;
  const since = new Date(Date.now() - 60000).toISOString();
  await admin.from("emails").insert([
    { contact_id: contactId, direction: "received", status: "received", subject: prefix, thread_id: thread, created_at: new Date(Date.now() - 86400000).toISOString() },
    { contact_id: contactId, direction: "received", status: "received", subject: prefix, thread_id: "unrelated", created_at: new Date().toISOString() },
  ]).throwOnError();
  let facts = await loadFlowFacts({ userId, contactId, companyId, conversationId: thread, since });
  assert.equal(facts.customerReplied, false);
  await admin.from("emails").insert({ contact_id: contactId, direction: "received", status: "received", subject: prefix, thread_id: thread, created_at: new Date().toISOString() }).throwOnError();
  facts = await loadFlowFacts({ userId, contactId, companyId, conversationId: thread, since });
  assert.equal(facts.customerReplied, true);
  pass("reply detection ignores old and unrelated-thread mail and recognizes a current reply");
  const emailId = await save([{ type: "send_email", config: { templateId: "helpful_reminder", mailboxId: "default", replyInThread: true, sendWindow: "anytime", stopOnReply: true } }]);
  const replyRun = await enrollMatchingFlows({ ...event, flowId: emailId, conversationId: thread, occurredAt: since, eventKey: randomUUID() });
  assert.equal(replyRun[0]?.reason, "cancelled");
  runIds.push(replyRun[0]!.runId!);
  const dryRun = await enrollMatchingFlows({ ...event, flowId: emailId, conversationId: `${thread}:new`, eventKey: randomUUID() });
  runIds.push(dryRun[0]!.runId!);
  assert.equal(dryRun[0]?.reason, "done");
  const { count: dryLogs } = await admin.from("flow_run_logs").select("id", { count: "exact", head: true }).eq("run_id", dryRun[0]!.runId!).eq("result->>action", "email_dry_run").throwOnError();
  assert.equal(dryLogs, 1);
  pass("replies cancel sends and eligible email execution is recorded as dry-run without SMTP delivery");
  const failedId = await save([{ type: "create_task", config: { assigneeType: "user", assigneeId: randomUUID(), dueInDays: 0, title: prefix } }]);
  const failed = await enrollMatchingFlows({ ...event, flowId: failedId, eventKey: randomUUID() });
  runIds.push(failed[0]!.runId!);
  assert.equal(failed[0]?.reason, "failed");
  const { count: errors } = await admin.from("flow_run_logs").select("id", { count: "exact", head: true }).eq("run_id", failed[0]!.runId!).not("error", "is", null).throwOnError();
  assert.equal(errors, 1);
  pass("backend action failures mark the run failed and persist the exact error");

  const timedId = await save([{ type: "stop", config: { outcome: "completed" } }]);
  await admin.from("flows").update({ trigger_type: "no_reply", trigger_config: { amount: 1, unit: "hours", segment: prefix } }).eq("id", timedId).throwOnError();
  const timedThread = `verify-time:${randomUUID()}`;
  const latestId = randomUUID();
  await admin.from("emails").insert([
    { id: randomUUID(), contact_id: contactId, direction: "sent", status: "sent", subject: prefix, thread_id: timedThread, sent_at: new Date(Date.now() - 3 * 86400000).toISOString() },
    { id: latestId, contact_id: contactId, direction: "sent", status: "sent", subject: prefix, thread_id: timedThread, sent_at: new Date(Date.now() - 30 * 60000).toISOString() },
  ]).throwOnError();
  assert.equal(await scanTimeBasedFlowTriggers(timedId), 0);
  await admin.from("emails").update({ sent_at: new Date(Date.now() - 2 * 3600000).toISOString() }).eq("id", latestId).throwOnError();
  assert.equal(await scanTimeBasedFlowTriggers(timedId), 1);
  assert.equal(await scanTimeBasedFlowTriggers(timedId), 0);
  pass("no-reply scanner waits for the latest message and does not re-enroll the same event");

  // Exercise authenticated HTTP handlers using a session generated without sending a login email.
  const { data: user } = await admin.auth.admin.getUserById(userId);
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: user.user!.email! });
  if (linkError) throw linkError;
  const cookies = new Map<string, string>();
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })), setAll: (values) => values.forEach(({ name, value }) => cookies.set(name, value)) } });
  const { error: sessionError } = await client.auth.verifyOtp({ token_hash: link.properties!.hashed_token, type: "magiclink" });
  if (sessionError) throw sessionError;
  const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  const origin = process.env.FLOW_TEST_ORIGIN || "http://localhost:3000";
  const testFlow = { name: prefix, triggerType: "company_segment_changed", triggerConfig: { segment: prefix }, status: "draft", steps: [{ type: "wait", config: { amount: 1, unit: "minutes" } }, { type: "stop", config: { outcome: "completed" } }] };
  const api = await fetch(`${origin}/api/flows/test`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ flow: testFlow, companyId, contactId }) });
  const result = await api.json();
  assert.equal(api.status, 200, JSON.stringify(result));
  assert.equal(result.mode, "simulation");
  assert.equal(result.profileMatches, true);
  assert.equal(result.trace.length, 2);
  const invalid = await fetch(`${origin}/api/flows/test`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ flow: { ...testFlow, steps: [{ type: "wait", config: { amount: 0 } }] } }) });
  assert.equal(invalid.status, 400);
  pass("authenticated audit API simulates the current unsaved draft and rejects invalid settings");
  const created = await fetch(`${origin}/api/flows`, { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(testFlow) });
  const createdResult = await created.json();
  assert.equal(created.status, 201, JSON.stringify(createdResult));
  flowIds.push(createdResult.flow.id);
  const updated = await fetch(`${origin}/api/flows/${createdResult.flow.id}`, { method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ ...testFlow, name: `${prefix} updated`, steps: [{ type: "stop", config: { reason: "HTTP saved", outcome: "cancelled" } }] }) });
  const updatedResult = await updated.json();
  assert.equal(updated.status, 200, JSON.stringify(updatedResult));
  assert.equal(updatedResult.flow.steps[0].config.reason, "HTTP saved");
  const insights = await fetch(`${origin}/api/flows/${id}/runs`, { headers: { Cookie: cookie } });
  const insightsResult = await insights.json();
  assert.equal(insights.status, 200);
  assert.ok(insightsResult.runs.some((run: { id: string }) => run.id === runId));
  assert.equal((await fetch(`${origin}/api/cron/flows`, { redirect: "manual" })).status, 401);
  pass("HTTP create, save and insights APIs persist settings; cron rejects missing bearer authorization");
  const { data: steps } = await admin.from("flow_steps").select("id").eq("flow_id", id).throwOnError();
  for (const kind of ["open", "click"] as const) {
    const token = signTracking({ runId, stepId: steps![0].id, kind, expires: Date.now() + 60000, ...(kind === "click" ? { target: "https://filazoo.com/catalog" } : {}) }, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const tracked = await fetch(`${origin}/api/flows/track?token=${token}`, { redirect: "manual" });
    assert.equal(tracked.status, kind === "open" ? 200 : 302);
  }
  const engagement = await loadFlowFacts({ userId, runId });
  assert.equal(engagement.openedEmail, true);
  assert.equal(engagement.clickedLink, true);
  pass("signed HTTP tracking endpoints persist opens and clicks used by backend conditions");
  await assert.rejects(validateFlowResources(userId, { ...testFlow, steps: [{ type: "send_email", config: { mailboxId: randomUUID() } }] } as never), /mailbox/i);
  pass("unavailable sender mailboxes fail backend validation");
  await client.auth.signOut({ scope: "local" });
  console.log(`Verified ${checks.length} integration checks. No customer email was sent.`);
} finally {
  if (runIds.length) {
    await admin.from("internal_notifications").delete().in("flow_run_id", runIds).throwOnError();
    await admin.from("crm_tasks").delete().in("flow_run_id", runIds).throwOnError();
  }
  if (stateKeys.length) await admin.from("email_inbox_state").delete().eq("user_id", userId).in("message_key", stateKeys).throwOnError();
  if (flowIds.length) await admin.from("flows").delete().in("id", flowIds).throwOnError();
  if (companyId) {
    const { data: contacts } = await admin.from("contacts").select("id").eq("company_id", companyId).throwOnError();
    if (contacts?.length) await admin.from("emails").delete().in("contact_id", contacts.map((contact) => contact.id)).throwOnError();
    await admin.from("companies").delete().eq("id", companyId).throwOnError();
  }
  console.log("Disposable verification records cleaned up.");
}
