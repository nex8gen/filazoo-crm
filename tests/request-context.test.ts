import test from "node:test";
import assert from "node:assert/strict";
import { requestContextInstruction, requestContextSelection } from "../lib/ai/request-context.ts";
import { workspaceAssistantInstruction } from "../lib/ai/workspace-assistant.ts";

const choices = [{ id: "page-a", name: "Acme Printing" }, { id: "named-b", name: "Inovecell" }];
test("vague page requests retain the active customer; a named other customer overrides it", () => {
  for (const text of ["Summarize this", "Reply to this email", "Create an invoice for this customer", "Update this profile", "Change the city to Berlin", "Create a task for Friday"]) assert.equal(requestContextSelection(text, "page-a", choices).usePageCompany, true, text);
  const named = requestContextSelection("Create an invoice for Inovecell", "page-a", choices);
  assert.equal(named.usePageCompany, false); assert.equal(named.namedCompanies[0].id, "named-b");
  assert.equal(requestContextSelection("Create an invoice for Acme Printing", "page-a", choices).usePageCompany, true);
  assert.equal(requestContextSelection("Compare Inovecell and Acme Printing", "page-a", choices).usePageCompany, false);
});
test("an explicitly named unknown recipient never inherits the open customer's evidence", () => {
  assert.equal(requestContextSelection("Send the catalog to New Buyer Ltd", "page-a", choices).usePageCompany, false);
  assert.equal(requestContextSelection("Send the catalog to this customer", "page-a", choices).usePageCompany, true);
});
test("both Chat and legacy Agent receive the same explicit-target and page-default policy", () => {
  for (const mode of ["analyze", "work"] as const) {
    const instructions = workspaceAssistantInstruction(mode, "2026-11-06T00:00:00Z");
    assert.ok(instructions.includes(requestContextInstruction));
    assert.match(instructions, /explicit general-knowledge question/i);
  }
  const chat = workspaceAssistantInstruction("analyze", "now");
  assert.match(chat, /look up authorized CRM records from any page/);
  assert.match(chat, /Never emit mutation actions in Chat/);
});
