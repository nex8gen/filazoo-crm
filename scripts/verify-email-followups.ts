// Authenticated API verification. Never sends email; all schedules are a year away
// and cancelled immediately. Only this run's follow-up/task/state is cleaned up.
// node --env-file=.env.local --conditions=react-server --experimental-strip-types scripts/verify-email-followups.ts
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { createSupabaseControl } from "../lib/supabase/control.ts";
import { createSupabaseAdmin } from "../lib/supabase/admin.ts";
import { withWorkspaceContext } from "../lib/workspace-context.ts";
import { groupEmailsByThread } from "../lib/email-threading.ts";
import { followupAnchors, followupMessageKey } from "../lib/email-followup.ts";
import { followupConversationFilters, indexFollowupActions } from "../lib/email-followup-filters.ts";
import type { InboxEmailItem } from "../lib/email-inbox.ts";

const origin = process.env.FOLLOWUP_TEST_ORIGIN || "http://localhost:3000";
const control = createSupabaseControl();
const { data: workspace } = await control.from("workspaces").select("id,owner_id").eq("is_legacy", true).single().throwOnError();
assert.ok(workspace);
const { data: user, error: userError } = await control.auth.admin.getUserById(workspace.owner_id);
assert.ifError(userError); assert.ok(user.user?.email);
const { data: link, error: linkError } = await control.auth.admin.generateLink({ type: "magiclink", email: user.user.email });
assert.ifError(linkError); assert.ok(link.properties?.hashed_token);
const cookies = new Map<string, string>();
const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!, { cookies: { getAll: () => [...cookies].map(([name, value]) => ({ name, value })), setAll: values => values.forEach(({ name, value }) => cookies.set(name, value)) } });
const { error: sessionError } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
assert.ifError(sessionError); cookies.set("crm_workspace", workspace.id);
const headers = { Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "), Origin: origin, "Content-Type": "application/json" };
async function get(path: string) { const response = await fetch(origin + path, { headers, signal: AbortSignal.timeout(90_000) }); const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result; }
async function post(input: unknown, expected = 200) {
  const response = await fetch(`${origin}/api/email/follow-up`, { method: "POST", headers, body: JSON.stringify(input), signal: AbortSignal.timeout(90_000) });
  const result = await response.json(); assert.equal(response.status, expected, JSON.stringify(result)); return result;
}
try {
  await withWorkspaceContext(workspace.id, async () => {
    const db = createSupabaseAdmin();
    const crmMode = process.argv.includes("--crm");
    if (process.argv.includes("--saved-status")) {
      const { data: row } = await db.from("email_message_followups").select("id,mailbox_id,message_id,anchors,purpose").eq("user_id", workspace.owner_id).order("updated_at", { ascending: false }).limit(1).single().throwOnError();
      const elapsed: number[] = [];
      for (let sample = 0; sample < 3; sample++) {
        const start = performance.now();
        const result = await post({ action: "status", mailboxId: row.mailbox_id, messageId: row.message_id, anchors: row.anchors });
        assert.equal(result.followup.id, row.id); assert.equal(result.followup.purpose, row.purpose);
        elapsed.push(Math.round(performance.now() - start));
      }
      const actions = (await get(`/api/email/follow-up?view=list&mailboxId=${encodeURIComponent(row.mailbox_id)}`)).actions;
      assert.ok(actions.some((action: { id: string }) => action.id === row.id));
      console.log(JSON.stringify({ savedStatusMs: elapsed, recordAndListAgree: true, readOnly: true, sentMail: false }));
      return;
    }
    let inbox = await get("/api/email/inbox?refresh=false");
    if (process.argv.includes("--diagnose-status")) {
      for (const mailbox of inbox.mailboxes) {
        const snapshot = mailbox.id === inbox.selectedMailboxId ? inbox : await get(`/api/email/inbox?refresh=false&mailboxId=${encodeURIComponent(mailbox.id)}`);
        const queries = [...groupEmailsByThread(snapshot.emails as InboxEmailItem[]).values()].map(group => {
          const message = group.at(-1)!;
          return new URLSearchParams({ mailboxId: message.mailboxId || mailbox.id, messageId: message.messageId || message.id, anchors: JSON.stringify(followupAnchors(group)) }).toString();
        }).sort((a, b) => b.length - a.length).slice(0, 3);
        for (const query of queries) {
          const start = performance.now();
          const response = await fetch(`${origin}/api/email/follow-up?${query}`, { headers, signal: AbortSignal.timeout(20_000) });
          console.log(JSON.stringify({ urlLength: query.length, status: response.status, contentType: response.headers.get("content-type"), redirected: response.redirected, elapsedMs: Math.round(performance.now() - start), error: response.ok ? null : (await response.text()).slice(0, 250) }));
        }
      }
      return;
    }
    if (process.argv.includes("--filter-list")) {
      const start = performance.now();
      const result = await get(`/api/email/follow-up?view=list&mailboxId=${encodeURIComponent(inbox.selectedMailboxId)}`);
      assert.ok(Array.isArray(result.actions));
      for (const action of result.actions) { assert.ok(Array.isArray(action.anchors)); assert.equal(action.body, undefined); assert.equal(action.recipient, undefined); }
      const index = indexFollowupActions(result.actions);
      const counts = { all: 0, ai: 0, manual: 0, completed: 0, nurture: 0 };
      for (const group of groupEmailsByThread(inbox.emails as InboxEmailItem[]).values()) {
        const available = group.filter(message => message.folder !== "trash");
        const filters = followupConversationFilters(available, index);
        if (filters.size) counts.all++;
        for (const filter of filters) counts[filter]++;
      }
      console.log(JSON.stringify({ filterListMs: Math.round(performance.now() - start), records: result.actions.length, counts, readOnly: true, sentMail: false }));
      return;
    }
    if (crmMode) {
      const team = inbox.mailboxes.find((mailbox: { type: string; sendConfigured: boolean }) => mailbox.type === "workspace" && mailbox.sendConfigured);
      assert.ok(team, "A connected team mailbox is required to verify CRM inquiries.");
      inbox = await get(`/api/email/inbox?refresh=false&mailboxId=${encodeURIComponent(team.id)}`);
    }
    let context: { mailboxId: string; messageId: string } | undefined;
    let conversation: InboxEmailItem[] = [];
    let baseline: string[] = [];
    for (const group of groupEmailsByThread(inbox.emails as InboxEmailItem[]).values()) {
      if (group.some(message => message.followUpAt)) continue;
      const latest = [...group].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).at(-1);
      if (!crmMode && latest?.direction === "inbound") {
        const { data: cached } = await db.from("mailbox_message_content").select("uid").eq("content->>messageId", latest.messageId).limit(1).throwOnError();
        if (!cached?.length) continue;
      }
      const message = group.find(message => message.direction === "inbound"
        && (crmMode ? !message.messageId && (message.source === "crm" || message.source === "shopify") : message.source !== "crm" && message.messageId && message.mailboxId)
        && !/^(?:no-?reply|mailer-daemon|postmaster)@/i.test(message.replyTo || message.contact));
      const mailboxId = message?.mailboxId || inbox.selectedMailboxId;
      if (!message || !mailboxId) continue;
      const attempt = { mailboxId, messageId: message.messageId || message.id, anchors: JSON.stringify(followupAnchors(group)) };
      const response = await fetch(`${origin}/api/email/follow-up?${new URLSearchParams(attempt)}`, { headers, signal: AbortSignal.timeout(90_000) });
      const result = await response.json();
      if (response.ok && result.followup === null) { context = attempt; conversation = group; baseline = group.map(followupMessageKey); break; }
    }
    assert.ok(context, "A synced conversation without an existing follow-up is required.");
    console.log(`Verifying ${crmMode ? "CRM inquiry without an RFC Message-ID" : "provider message"}.`);
    if (process.argv.includes("--status-only")) {
      const elapsed: number[] = [];
      for (let sample = 0; sample < 3; sample++) {
        const start = performance.now();
        const response: Response = await fetch(`${origin}/api/email/follow-up`, { method: "POST", headers, body: JSON.stringify({ action: "status", ...context, anchors: followupAnchors(conversation) }), signal: AbortSignal.timeout(15_000) });
        assert.equal(response.status, 200, await response.clone().text()); await response.json();
        elapsed.push(Math.round(performance.now() - start));
        console.log(JSON.stringify({ statusMs: elapsed.at(-1), serverTiming: response.headers.get("server-timing") }));
      }
      console.log(JSON.stringify({ statusOnly: true, medianMs: elapsed.sort((a, b) => a - b)[1], sentMail: false }));
      return;
    }
    const keys = conversation.map(message => message.id);
    const { data: previousStates } = await db.from("email_inbox_state").select("*").eq("user_id", workspace.owner_id).in("message_key", keys).throwOnError();
    const id = randomUUID(); let taskId: string | null = null;
    const input = { ...context, action: "save", id, revision: 0, kind: "reminder", dueAt: new Date(Date.now() + 364 * 86400_000).toISOString(), subject: "Disposable API follow-up verification", body: "", baseline };
    try {
      const crossOrigin = await fetch(`${origin}/api/email/follow-up`, { method: "POST", headers: { ...headers, Origin: "https://attacker.invalid" }, body: JSON.stringify(input) });
      assert.equal(crossOrigin.status, 403);
      await post({ ...input, dueAt: new Date(Date.now() - 1000).toISOString() }, 409);
      const saved = (await post(input)).followup; taskId = saved.task_id;
      assert.equal(saved.status, "scheduled"); assert.ok(taskId);
      const task = await db.from("crm_tasks").select("due_at,status").eq("id", taskId).single().throwOnError();
      assert.equal(task.data.status, "open"); assert.equal(Date.parse(task.data.due_at), Date.parse(input.dueAt));
      const loaded = await get(`/api/email/follow-up?${new URLSearchParams(context)}`);
      assert.equal(loaded.followup.id, id);
      const changed = (await post({ ...input, revision: saved.revision, dueAt: new Date(Date.now() + 363 * 86400_000).toISOString() })).followup;
      assert.equal(changed.task_id, taskId);
      await post({ action: "cancel", id, revision: saved.revision }, 409);
      const cancelled = (await post({ action: "cancel", id, revision: changed.revision })).followup;
      assert.equal(cancelled.status, "cancelled");
      const cancelledTask = await db.from("crm_tasks").select("status").eq("id", taskId).single().throwOnError();
      assert.equal(cancelledTask.data.status, "cancelled");
      console.log("PASS reminder save/reload/reschedule/cancel, task lifecycle, stale-write rejection and request guards.");
      const preview = await post({ ...context, action: "preview" });
      assert.ok(preview.body.trim()); assert.ok(preview.baseline.length);
      // Far-future reviewed email proves durable storage without exercising SMTP.
      const ai = (await post({ ...input, kind: "ai", purpose: "nurture", revision: cancelled.revision, subject: preview.subject, body: preview.body, baseline: preview.baseline })).followup;
      assert.equal(ai.kind, "ai"); assert.equal(ai.status, "scheduled");
      assert.equal(ai.purpose, "nurture");
      const actions = (await get(`/api/email/follow-up?view=list&mailboxId=${encodeURIComponent(context.mailboxId)}`)).actions;
      const action = actions.find((item: { id: string }) => item.id === id);
      assert.equal(action.purpose, "nurture"); assert.equal(action.dueAt, ai.due_at);
      assert.deepEqual([...followupConversationFilters(conversation, indexFollowupActions(actions))], ["nurture"]);
      await post({ action: "cancel", id, revision: ai.revision });
      const { data: delivery } = await db.from("email_message_followups").select("delivery_id").eq("id", id).single().throwOnError();
      const { count } = await db.from("email_send_operations").select("id", { count: "exact", head: true }).eq("id", delivery.delivery_id).throwOnError();
      assert.equal(count, 0);
      console.log("PASS authenticated read, reminder save/reload/reschedule/cancel, task lifecycle, stale-write rejection, origin guard, past-time rejection, live AI preview and cancelled future AI schedule. No email sent.");
    } finally {
      const { data: current } = await db.from("email_message_followups").select("status,task_id,delivery_id").eq("id", id).eq("user_id", workspace.owner_id).maybeSingle().throwOnError();
      if (current) {
        assert.notEqual(current.status, "processing", "Do not clean up an active delivery.");
        await db.from("email_message_followups").update({ status: "cancelled" }).eq("id", id).eq("user_id", workspace.owner_id).throwOnError();
        await db.from("email_message_followups").delete().eq("id", id).eq("user_id", workspace.owner_id).throwOnError();
      }
      if (taskId) {
        await db.from("internal_notifications").delete().eq("task_id", taskId).throwOnError();
        await db.from("crm_tasks").delete().eq("id", taskId).throwOnError();
      }
      // Restore only markers changed by this test; preserve concurrent read/star updates.
      for (const key of keys) {
        const previous = previousStates?.find(state => state.message_key === key);
        await db.from("email_inbox_state").update({ follow_up_at: previous?.follow_up_at || null }).eq("user_id", workspace.owner_id).eq("message_key", key).throwOnError();
      }
      console.log("PASS disposable follow-up/task removed and previous inbox reminders restored.");
    }
  });
} finally { await client.auth.signOut({ scope: "local" }); }
