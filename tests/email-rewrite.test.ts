import assert from "node:assert/strict";
import test from "node:test";
import {
  applyEmailSignature,
  buildEmailRewriteInstruction,
  buildEmailRewritePrompt,
  DEFAULT_EMAIL_COMPANY,
  DEFAULT_EMAIL_TITLE,
  normalizeSignatureName,
} from "../lib/ai/email-rewrite.ts";

const signature = { name: "Raul Chen", title: DEFAULT_EMAIL_TITLE, company: DEFAULT_EMAIL_COMPANY };

test("the rewrite prompt identifies the assigned BD manager and forbids placeholders", () => {
  const instruction = buildEmailRewriteInstruction(signature);
  assert.match(instruction, /Raul Chen\nBD Sales Manager\nFilazoo/);
  assert.match(instruction, /never output placeholders/i);
});

test("the final email always uses the assigned manager signature", () => {
  const output = applyEmailSignature(
    "Hi Isaac,\n\nHere is our catalog.\n\nBest regards,\n\n[Your Name]\n[Your Title]\n[Your Company]",
    signature,
  );
  assert.equal(output, "Hi Isaac,\n\nHere is our catalog.\n\nBest regards,\n\nRaul Chen\nBD Sales Manager\nFilazoo");
});

test("an unassigned owner falls back without leaking a placeholder", () => {
  assert.equal(normalizeSignatureName(" Unassigned ", "Active User"), "Active User");
  assert.equal(normalizeSignatureName(undefined), "Filazoo Sales Team");
});

test("the rewrite prompt reviews the CRM profile, manager input, and prior conversation", () => {
  const prompt = buildEmailRewritePrompt({
    recipient: "Isaac",
    managerInput: "Send the catalog and ask about PLA and PETG requirements.",
    customerProfile: {
      companyName: "Example Print Farm",
      contactName: "Isaac",
      segment: "Print farm",
      summary: "Produces functional parts for industrial customers.",
      interests: ["PLA", "PETG"],
      fitScore: 9,
    },
    conversationHistory: [
      { direction: "inbound", subject: "Catalog", body: "Can you send your catalog?", timestamp: "2026-10-22T08:00:00Z" },
      { direction: "outbound", subject: "Re: Catalog", body: "Certainly.", timestamp: "2026-10-22T08:05:00Z" },
    ],
  });
  assert.ok(prompt.indexOf("CUSTOMER PROFILE") < prompt.indexOf("BD MANAGER INPUT"));
  assert.ok(prompt.indexOf("BD MANAGER INPUT") < prompt.indexOf("CONVERSATION HISTORY"));
  assert.match(prompt, /Example Print Farm/);
  assert.match(prompt, /Send the catalog/);
  assert.match(prompt, /Can you send your catalog/);
});
