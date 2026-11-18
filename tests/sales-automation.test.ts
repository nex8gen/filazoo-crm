import assert from "node:assert/strict";
import test from "node:test";
import { calculateWaitUntil } from "../lib/flow-engine.ts";
import { createFlowRecipe } from "../lib/flow-recipes.ts";
import { flowInputSchema } from "../lib/flows.ts";
import { groupHomePriorities } from "../lib/home-priorities.ts";
import { followupConversationFilters, indexFollowupActions } from "../lib/email-followup-filters.ts";
import { emailFollowupBadge } from "../lib/email-followup-badge.ts";
import { leadIntroduction } from "../lib/lead-intake.ts";
import { resolveLibrarySelection, librarySearchInput, libraryQueries } from "../lib/ai/library-search.ts";
import type { LibraryDocument } from "../lib/documents.ts";

test("calendar-month milestones clamp month ends and remain anchored to the same trigger", () => {
  const start = new Date("2027-01-31T10:30:00Z");
  assert.equal(calculateWaitUntil({ amount: 1, unit: "months" }, start).toISOString(), "2027-02-28T10:30:00.000Z");
  assert.equal(calculateWaitUntil({ amount: 3, unit: "months" }, start).toISOString(), "2027-04-30T10:30:00.000Z");
  const flow = flowInputSchema.parse(createFlowRecipe("dormant"));
  assert.deepEqual(flow.steps.filter(s => s.type === "wait").map(s => [s.config.amount, s.config.unit, s.config.anchor]), [[1,"months","trigger"],[3,"months","trigger"],[6,"months","trigger"],[12,"months","trigger"]]);
  assert.ok(flow.steps.filter(s => s.type === "ai_auto_reply").every(s => s.config.stopOnReply && !s.config.usePrices));
});

test("new-lead intake attaches a catalog and always hands over next business morning", () => {
  const flow = flowInputSchema.parse(createFlowRecipe("lead_intake"));
  const reply = flow.steps.find(s => s.type === "ai_auto_reply")!;
  assert.equal(reply.config.leadIntake, true); assert.equal(reply.config.attachCatalog, true); assert.equal(reply.config.usePrices, false);
  const handoff = flow.steps.filter(s => s.type === "wait")[1];
  assert.equal(calculateWaitUntil(handoff.config, new Date("2026-11-20T08:00:00Z")).toISOString(), "2026-11-23T01:00:00.000Z");
  assert.ok(flow.steps.some(s => s.type === "create_task"));
  assert.doesNotMatch(leadIntroduction(undefined, "Bonita", false), /attached/i);
});

test("home priorities use actual saved priority and Shanghai due dates and omit closed tasks", () => {
  const tasks = [
    { id: "high", title: "A", priority: "high", due_at: "2026-11-18T15:59:00Z", status: "open", notes: null, company_id: null, updated_at: "now" },
    { id: "later", title: "B", priority: "normal", due_at: "2026-11-18T16:00:00Z", status: "open", notes: null, company_id: null, updated_at: "now" },
    { id: "closed", title: "C", priority: "high", due_at: null, status: "done", notes: null, company_id: null, updated_at: "now" },
  ];
  const groups = groupHomePriorities(tasks, "2026-11-18T06:00:00Z");
  assert.deepEqual(groups.urgent_important.map(t => t.id), ["high"]);
  assert.deepEqual(groups.later.map(t => t.id), ["later"]);
  assert.equal(groups.important.length, 0);
});

test("AI file selection cannot invent IDs or return inaccessible files", () => {
  assert.ok(libraryQueries("Find the template named Agency — Portfolio & Projects", ["Agency Portfolio Projects"]).includes("Agency — Portfolio & Projects"));
  const id = "11111111-1111-4111-8111-111111111111";
  const file = { id, name: "Catalog.pdf" } as LibraryDocument;
  assert.equal(resolveLibrarySelection({ ids: [id,id], explanation: "Latest catalog" }, [file]).documents.length, 1);
  assert.throws(() => resolveLibrarySelection({ ids: ["22222222-2222-4222-8222-222222222222"], explanation: "" }, [file]), /unavailable/);
  assert.ok(!librarySearchInput.safeParse({ query: "catalog", send: true }).success);
});

test("saved inactive-customer workflows appear in email status without enrolling unrelated conversations", () => {
  const record = { id: "run", source: "workflow" as const, companyId: "customer", kind: "ai" as const, purpose: "nurture" as const, status: "scheduled", threadKey: "company:customer", anchors: [], updatedAt: "2026-11-18", progress: "2/4" };
  const index = indexFollowupActions([record]);
  assert.deepEqual([...followupConversationFilters([{ id: "email", companyId: "customer" }], index)], ["nurture"]);
  assert.deepEqual([...followupConversationFilters([{ id: "other", companyId: "unrelated" }], index)], []);
  assert.equal(emailFollowupBadge([record], "en", new Date()).detail, "2/4");
  assert.equal(emailFollowupBadge([{ ...record, status: "paused" }], "en", new Date()).label, "Paused");
});
