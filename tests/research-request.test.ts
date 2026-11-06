import test from "node:test";
import assert from "node:assert/strict";
import { companyResearchTarget, webSearchForRequest } from "../lib/ai/research-request.ts";

const choices = [{ id: "inovecell-brazil", name: "Inovecell", city: "Cachoeirinha", country: "Brazil" }, { id: "other", name: "Example Print", city: "Boston", country: "United States" }];
const messages = (content: string) => [{ role: "user", content }];
test("the reported research request enables search before sending, while explicit Off and private-record requests stay off", () => {
  for (const text of ["Research Inovecell again.", "Please research Inovecell", "can you search online for this company", "Find public information about Inovecell", "Search Google for Vercel"]) assert.equal(webSearchForRequest("auto", text), true, text);
  for (const text of ["Summarize Analytics", "Research our invoices", "Research unpaid orders", "Analyze this CRM page", "Do not use web search. Research Inovecell", "Research Inovecell using only saved records"]) assert.equal(webSearchForRequest("auto", text), false, text);
  assert.equal(webSearchForRequest("off", "Research Inovecell again."), false);
  assert.equal(webSearchForRequest("on", "Summarize Analytics"), true);
  assert.equal(webSearchForRequest("on", "Use only CRM data. Research Inovecell"), false);
});
test("a named company resolves from authorized choices without an open company page", () => {
  assert.deepEqual(companyResearchTarget({ messages: messages("Research Inovecell again."), choices }), { companyId: "inovecell-brazil", identity: { name: "Inovecell", city: "Cachoeirinha", country: "Brazil", website: undefined } });
});
test("an explicit new name takes precedence over the open company and previous conversation", () => {
  const target = companyResearchTarget({ messages: [...messages("Research Example Print"), ...messages("Research Inovecell again.")], currentCompany: { id: "other", fields: { name: "Example Print", website: "https://example.com" } }, choices });
  assert.equal(target.companyId, "inovecell-brazil");
  assert.deepEqual(companyResearchTarget({ messages: messages('Research "Vercel" again.'), choices }), { identity: { name: "Vercel" } });
});
test("namesakes and multiple named companies require a choice, and a city disambiguates", () => {
  const duplicates = [choices[0], { ...choices[0], id: "inovecell-niteroi", city: "Niterói" }];
  assert.match(companyResearchTarget({ messages: messages("Research Inovecell"), choices: duplicates }).question!, /Which company/);
  assert.equal(companyResearchTarget({ messages: messages("Research Inovecell in Niterói"), choices: duplicates }).companyId, "inovecell-niteroi");
  assert.match(companyResearchTarget({ messages: messages("Research Inovecell and Example Print"), choices }).question!, /Which company/);
});
test("this-company and retry followups use explicit context without inventing a target from Analytics", () => {
  const currentCompany = { id: "inovecell-brazil", fields: { name: "Inovecell", city: "Cachoeirinha" } };
  assert.equal(companyResearchTarget({ messages: messages("Research this company"), currentCompany, choices }).companyId, currentCompany.id);
  assert.equal(companyResearchTarget({ messages: [...messages("Research Inovecell"), ...messages("Try again")], choices }).companyId, currentCompany.id);
  assert.match(companyResearchTarget({ messages: messages("Research this company"), choices }).question!, /Which company/);
});

test("research about this customer preserves the selected company identity and website", () => {
  const currentCompany = { id: "3d-near-you", fields: { name: "3D Near You", website: "https://3dnearyou.com/", city: "Brooklyn", country: "United States" } };
  for (const request of ["Research about this customer", "Research more about this customer.", "Research information about the selected customer", "Research about the customer", "Research about it"]) {
    assert.deepEqual(companyResearchTarget({ messages: messages(request), currentCompany, choices }), { companyId: currentCompany.id, identity: currentCompany.fields }, request);
    assert.match(companyResearchTarget({ messages: messages(request), choices }).question!, /Which company/, request);
  }
  assert.deepEqual(companyResearchTarget({ messages: messages("Research about Vercel"), currentCompany, choices }), { identity: { name: "Vercel" } });
});

test("email subjects resolve saved business identity or remain email clues for public discovery", () => {
  const company = { id: "3d-near-you", name: "3D Near You", website: "https://3dnearyou.com/", contacts: [{ email: "info@3dnearyou.com" }] };
  const target = companyResearchTarget({ messages: messages("Research info@3dnearyou.com"), choices: [company] });
  assert.equal(target.companyId, company.id);
  assert.equal(target.identity?.name, company.name);
  assert.equal(target.identity?.email, company.contacts[0].email);
  assert.equal(target.identity?.website, company.website);
  assert.deepEqual(companyResearchTarget({ messages: messages("Research info@3dnearyou.com") }), { identity: { email: "info@3dnearyou.com" } });
  assert.equal(companyResearchTarget({ messages: messages("Research info@3dnearyou.com.other"), choices: [company] }).companyId, undefined);
});
