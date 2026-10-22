// Input: a JSON array of bridge leads. Preview by default; add --execute to save.
// Keep lead exports in an ignored/private directory, never in source control.
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { bridgeLeadRow, bridgeLeadSchema } from "../lib/meta-lead-bridge.ts";

const file = process.argv[2];
if (!file) throw new Error("Pass a private JSON file containing normalized Meta leads.");
const input = JSON.parse(await readFile(file, "utf8"));
if (!Array.isArray(input) || input.length === 0) throw new Error("Expected a nonempty lead array.");
const leads = input.map((value, index) => {
  const parsed = bridgeLeadSchema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid lead at row ${index + 1}: ${parsed.error.issues.map((issue) => issue.path.join(".") + ": " + issue.message).join("; ")}`);
  return parsed.data;
});
const ids = leads.map((lead) => lead.lead_id);
if (new Set(ids).size !== ids.length) throw new Error("Duplicate lead IDs in import file.");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("CRM server database configuration is missing.");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: before, error: readError } = await db.from("meta_leads").select("leadgen_id").in("leadgen_id", ids);
if (readError) throw new Error(`Unable to inspect existing leads: ${readError.code || "connection error"}`);
const existing = new Set((before ?? []).map((row) => row.leadgen_id));
const pending = leads.filter((lead) => !existing.has(lead.lead_id));
console.log(JSON.stringify({ mode: process.argv.includes("--execute") ? "import" : "preview", sourceRows: leads.length, alreadyPresent: existing.size, newLeads: pending.length }));
if (process.argv.includes("--execute")) {

let inserted = 0;
let assigned = 0;
for (const lead of pending) {
  const row = bridgeLeadRow(lead);
  row.raw_payload.source = "meta_csv_backfill";
  const { data, error } = await db.from("meta_leads").upsert(row, { onConflict: "leadgen_id", ignoreDuplicates: true }).select("leadgen_id");
  if (error) throw new Error(`Import stopped after ${inserted} leads: ${error.code}`);
  if (!data?.length) continue;
  inserted++;
  const owner = await db.rpc("claim_next_bd_sales_manager");
  if (owner.error) throw new Error(`Lead saved but assignment failed: ${owner.error.code}. Import can be resumed without duplicating records.`);
  if (owner.data) {
    const update = await db.from("meta_leads").update({ owner_id: owner.data, assignment_method: "automatic" }).eq("leadgen_id", lead.lead_id).is("owner_id", null);
    if (update.error) throw new Error(`Lead saved but assignment update failed: ${update.error.code}`);
    assigned++;
  }
}
const { data: saved, error: verifyError } = await db.from("meta_leads").select("leadgen_id,full_name,email,phone,created_at,form_id,ad_id,field_data").in("leadgen_id", ids);
if (verifyError || saved?.length !== leads.length) throw new Error("Import count verification failed.");
const savedById = new Map(saved.map((row) => [row.leadgen_id, row]));
for (const lead of pending) {
  const expected = bridgeLeadRow(lead);
  const actual = savedById.get(lead.lead_id);
  for (const field of ["full_name", "email", "phone", "form_id", "ad_id"]) {
    if (actual[field] !== expected[field]) throw new Error(`Saved ${field} does not match export.`);
  }
  if (JSON.stringify(actual.field_data) !== JSON.stringify(expected.field_data)) throw new Error("Saved form answers do not match export.");
  if (expected.created_at && Date.parse(actual.created_at) !== Date.parse(expected.created_at)) throw new Error("Submission time does not match export.");
}
console.log(JSON.stringify({ inserted, assigned, verifiedLeadCount: saved.length, verifiedFields: ["name", "email", "phone", "form", "ad", "answers", "submission_time"] }));
}
