import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !secret) throw new Error("Supabase URL and secret key are required.");
if (process.env.DRY_RUN === "false") throw new Error("Refusing to seed sample outreach data while DRY_RUN=false.");

const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const seed = "filazoo_sample_v1";

const companyIds = {
  nova: "10000000-0000-4000-8000-000000000001",
  proto: "10000000-0000-4000-8000-000000000002",
  additive: "10000000-0000-4000-8000-000000000003",
  maker: "10000000-0000-4000-8000-000000000004",
  flex: "10000000-0000-4000-8000-000000000005",
  academy: "10000000-0000-4000-8000-000000000006",
} as const;

const contactIds = {
  nova: "20000000-0000-4000-8000-000000000001",
  proto: "20000000-0000-4000-8000-000000000002",
  additive: "20000000-0000-4000-8000-000000000003",
  maker: "20000000-0000-4000-8000-000000000004",
  flex: "20000000-0000-4000-8000-000000000005",
  academy: "20000000-0000-4000-8000-000000000006",
} as const;

const catalogIds = [
  "30000000-0000-4000-8000-000000000001",
  "30000000-0000-4000-8000-000000000002",
  "30000000-0000-4000-8000-000000000003",
] as const;

const eventIds = [
  "50000000-0000-4000-8000-000000000001",
  "50000000-0000-4000-8000-000000000002",
  "50000000-0000-4000-8000-000000000003",
  "50000000-0000-4000-8000-000000000004",
  "50000000-0000-4000-8000-000000000005",
] as const;

async function upsert(table: string, rows: Record<string, unknown>[], onConflict?: string) {
  const { error } = await db.from(table).upsert(rows, onConflict ? { onConflict } : undefined);
  if (error) throw new Error(`${table}: ${error.message}`);
}

await upsert("products", [
  { sku: "SAMPLE-PLA-BLK", name: "[SAMPLE] Performance PLA Black", material: "PLA", color: "Black", diameter: "1.75 mm", weight: "1 kg", price: 18.9, currency: "EUR", moq: 24, stock_status: "In stock", lead_time: "3–5 days", tags: ["sample", "high-speed"], description: "Sample product for CRM demonstrations.", active: true },
  { sku: "SAMPLE-PETG-CLEAR", name: "[SAMPLE] Technical PETG Clear", material: "PETG", color: "Clear", diameter: "1.75 mm", weight: "1 kg", price: 21.5, currency: "EUR", moq: 24, stock_status: "In stock", lead_time: "3–5 days", tags: ["sample", "outdoor"], description: "Sample product for CRM demonstrations.", active: true },
  { sku: "SAMPLE-TPU-95A", name: "[SAMPLE] Flexible TPU 95A", material: "TPU", color: "Black", diameter: "1.75 mm", weight: "1 kg", price: 29.9, currency: "EUR", moq: 12, stock_status: "In stock", lead_time: "5–7 days", tags: ["sample", "flexible"], description: "Sample product for CRM demonstrations.", active: true },
  { sku: "SAMPLE-ABS-GRY", name: "[SAMPLE] Industrial ABS Grey", material: "ABS", color: "Grey", diameter: "1.75 mm", weight: "1 kg", price: 23.4, currency: "EUR", moq: 24, stock_status: "Made to order", lead_time: "7–10 days", tags: ["sample", "industrial"], description: "Sample product for CRM demonstrations.", active: true },
  { sku: "SAMPLE-PLA-COLOR", name: "[SAMPLE] Education PLA Color Pack", material: "PLA", color: "Mixed", diameter: "1.75 mm", weight: "10 × 250 g", price: 54, currency: "EUR", moq: 8, stock_status: "In stock", lead_time: "3–5 days", tags: ["sample", "education"], description: "Sample product for CRM demonstrations.", active: true },
], "sku");

await upsert("companies", [
  { id: companyIds.nova, name: "[SAMPLE] NovaLayer Print Farm", website: "https://novalayer.example", domain: "novalayer.example", country: "Germany", city: "Berlin", segment: "3D printing farm", employee_count: 28, source: "sample_seed", source_url: "https://example.com/filazoo-sample-data", status: "qualified" },
  { id: companyIds.proto, name: "[SAMPLE] ProtoForge Studio", website: "https://protoforge.example", domain: "protoforge.example", country: "United Kingdom", city: "Manchester", segment: "Rapid prototyping", employee_count: 16, source: "sample_seed", source_url: "https://example.com/filazoo-sample-data", status: "researching" },
  { id: companyIds.additive, name: "[SAMPLE] AdditiveWorks Distribution", website: "https://additiveworks.example", domain: "additiveworks.example", country: "Netherlands", city: "Rotterdam", segment: "Filament distributor", employee_count: 42, source: "sample_seed", source_url: "https://example.com/filazoo-sample-data", status: "contacted" },
  { id: companyIds.maker, name: "[SAMPLE] MakerBridge University Lab", website: "https://makerbridge.example", domain: "makerbridge.example", country: "United States", city: "Boston", segment: "University laboratory", employee_count: 12, source: "sample_seed", source_url: "https://example.com/filazoo-sample-data", status: "engaged" },
  { id: companyIds.flex, name: "[SAMPLE] FlexFab Manufacturing", website: "https://flexfab.example", domain: "flexfab.example", country: "Poland", city: "Wrocław", segment: "Industrial manufacturer", employee_count: 85, source: "sample_seed", source_url: "https://example.com/filazoo-sample-data", status: "qualified" },
  { id: companyIds.academy, name: "[SAMPLE] LayerLoop Academy", website: "https://layerloop.example", domain: "layerloop.example", country: "Singapore", city: "Singapore", segment: "Training center", employee_count: 9, source: "sample_seed", source_url: "https://example.com/filazoo-sample-data", status: "new" },
], "id");

await upsert("contacts", [
  { id: contactIds.nova, company_id: companyIds.nova, name: "Elena Fischer", role: "Procurement Lead", email: "elena@novalayer.example", verification_status: "valid", verification_provider: "sample_seed", confidence: 100 },
  { id: contactIds.proto, company_id: companyIds.proto, name: "Oliver Grant", role: "Studio Director", email: "oliver@protoforge.example", verification_status: "valid", verification_provider: "sample_seed", confidence: 100 },
  { id: contactIds.additive, company_id: companyIds.additive, name: "Sanne de Vries", role: "Category Manager", email: "sanne@additiveworks.example", verification_status: "valid", verification_provider: "sample_seed", confidence: 100 },
  { id: contactIds.maker, company_id: companyIds.maker, name: "Dr. Maya Chen", role: "Lab Manager", email: "maya@makerbridge.example", verification_status: "valid", verification_provider: "sample_seed", confidence: 100 },
  { id: contactIds.flex, company_id: companyIds.flex, name: "Piotr Nowak", role: "Additive Manufacturing Lead", email: "piotr@flexfab.example", verification_status: "valid", verification_provider: "sample_seed", confidence: 100 },
  { id: contactIds.academy, company_id: companyIds.academy, name: "Aisha Tan", role: "Program Director", email: "aisha@layerloop.example", verification_status: "unverified", verification_provider: "sample_seed", confidence: 75 },
], "id");

await upsert("company_profiles", [
  { company_id: companyIds.nova, summary: "[SAMPLE] Production print farm evaluating reliable high-speed PLA and PETG supply.", products_they_print: "Short-run consumer parts and fixtures", likely_materials: ["PLA", "PETG"], likely_products: ["SAMPLE-PLA-BLK", "SAMPLE-PETG-CLEAR"], company_size: "25–50", fit_score: 9, interest_tags: ["Bulk", "High-speed", "PETG"], evidence: [{ source: "sample_seed", note: "Synthetic demonstration record" }], model_name: "sample_seed", profiled_at: new Date().toISOString() },
  { company_id: companyIds.proto, summary: "[SAMPLE] Rapid-prototyping studio with mixed material requirements and short lead times.", products_they_print: "Functional prototypes", likely_materials: ["PLA", "ABS", "TPU"], likely_products: ["SAMPLE-ABS-GRY", "SAMPLE-TPU-95A"], company_size: "10–25", fit_score: 8, interest_tags: ["Prototyping", "TPU", "Fast delivery"], evidence: [{ source: "sample_seed", note: "Synthetic demonstration record" }], model_name: "sample_seed", profiled_at: new Date().toISOString() },
  { company_id: companyIds.additive, summary: "[SAMPLE] Regional distributor considering a private-label filament range.", products_they_print: "Distribution and resale", likely_materials: ["PLA", "PETG", "ABS"], likely_products: ["SAMPLE-PLA-BLK", "SAMPLE-PETG-CLEAR", "SAMPLE-ABS-GRY"], company_size: "25–50", fit_score: 10, interest_tags: ["Distribution", "Private label", "Big order"], evidence: [{ source: "sample_seed", note: "Synthetic demonstration record" }], model_name: "sample_seed", profiled_at: new Date().toISOString() },
  { company_id: companyIds.maker, summary: "[SAMPLE] University lab purchasing accessible materials for engineering courses.", products_they_print: "Student projects and research fixtures", likely_materials: ["PLA", "PETG"], likely_products: ["SAMPLE-PLA-COLOR", "SAMPLE-PETG-CLEAR"], company_size: "10–25", fit_score: 7, interest_tags: ["Education", "Color packs"], evidence: [{ source: "sample_seed", note: "Synthetic demonstration record" }], model_name: "sample_seed", profiled_at: new Date().toISOString() },
  { company_id: companyIds.flex, summary: "[SAMPLE] Manufacturer assessing TPU for protective production components.", products_they_print: "Flexible guards and assembly aids", likely_materials: ["TPU", "ABS"], likely_products: ["SAMPLE-TPU-95A", "SAMPLE-ABS-GRY"], company_size: "50–100", fit_score: 9, interest_tags: ["Industrial", "TPU", "Volume pricing"], evidence: [{ source: "sample_seed", note: "Synthetic demonstration record" }], model_name: "sample_seed", profiled_at: new Date().toISOString() },
  { company_id: companyIds.academy, summary: "[SAMPLE] Training center planning beginner workshops with compact material kits.", products_they_print: "Training models", likely_materials: ["PLA"], likely_products: ["SAMPLE-PLA-COLOR"], company_size: "1–10", fit_score: 6, interest_tags: ["Education", "Starter kits"], evidence: [{ source: "sample_seed", note: "Synthetic demonstration record" }], model_name: "sample_seed", profiled_at: new Date().toISOString() },
], "company_id");

await upsert("pipeline", [
  { company_id: companyIds.nova, stage: "interested", notes: "[SAMPLE] Requested pricing for a quarterly supply plan.", estimated_value: 18000, currency: "EUR", next_followup_at: "2026-10-13T09:00:00Z" },
  { company_id: companyIds.proto, stage: "replied", notes: "[SAMPLE] Asked about sample spools and lead times.", estimated_value: 6500, currency: "GBP", next_followup_at: "2026-10-14T10:30:00Z" },
  { company_id: companyIds.additive, stage: "big_order", notes: "[SAMPLE] Evaluating a 12-pallet private-label order.", estimated_value: 78000, currency: "EUR", next_followup_at: "2026-10-12T08:00:00Z" },
  { company_id: companyIds.maker, stage: "won", notes: "[SAMPLE] Pilot education bundle approved.", estimated_value: 4200, currency: "USD" },
  { company_id: companyIds.flex, stage: "contacted", notes: "[SAMPLE] Technical data sheet sent for internal review.", estimated_value: 26000, currency: "EUR", next_followup_at: "2026-10-16T11:00:00Z" },
  { company_id: companyIds.academy, stage: "new", notes: "[SAMPLE] Needs contact verification before outreach.", estimated_value: 2500, currency: "USD" },
], "company_id");

await upsert("catalogs", [
  { id: "30000000-0000-4000-8000-000000000001", company_id: companyIds.nova, product_skus: ["SAMPLE-PLA-BLK", "SAMPLE-PETG-CLEAR"], currency: "EUR", price_date: "2026-10-10", version: 1 },
  { id: "30000000-0000-4000-8000-000000000002", company_id: companyIds.additive, product_skus: ["SAMPLE-PLA-BLK", "SAMPLE-PETG-CLEAR", "SAMPLE-ABS-GRY", "SAMPLE-TPU-95A"], currency: "EUR", price_date: "2026-10-10", version: 1 },
  { id: "30000000-0000-4000-8000-000000000003", company_id: companyIds.maker, product_skus: ["SAMPLE-PLA-COLOR", "SAMPLE-PETG-CLEAR"], currency: "USD", price_date: "2026-10-10", version: 1 },
], "id");

await upsert("emails", [
  { id: "40000000-0000-4000-8000-000000000001", contact_id: contactIds.nova, catalog_id: "30000000-0000-4000-8000-000000000001", direction: "sent", subject: "[SAMPLE] Reliable PLA and PETG supply for NovaLayer", body: "Hi Elena, this is a synthetic draft showing how a tailored Filazoo introduction could look. Nothing has been sent.", thread_id: "sample-nova", message_id: "sample-nova-draft-1", status: "pending_approval", step: 1 },
  { id: "40000000-0000-4000-8000-000000000002", contact_id: contactIds.flex, direction: "sent", subject: "[SAMPLE] TPU 95A for production fixtures", body: "Hi Piotr, this sample draft highlights technical TPU and ABS options for your manufacturing workflow. Nothing has been sent.", thread_id: "sample-flex", message_id: "sample-flex-draft-1", status: "draft", step: 1 },
  { id: "40000000-0000-4000-8000-000000000003", contact_id: contactIds.proto, direction: "received", subject: "Re: [SAMPLE] Materials for rapid prototyping", body: "[SAMPLE REPLY] Thanks. Please send sample-spool pricing and your normal lead time for TPU and ABS.", thread_id: "sample-proto", message_id: "sample-proto-reply-1", status: "received", step: 1, sent_at: "2026-10-09T14:30:00Z" },
  { id: "40000000-0000-4000-8000-000000000004", contact_id: contactIds.additive, direction: "received", subject: "Re: [SAMPLE] Private-label filament program", body: "[SAMPLE REPLY] We are considering twelve pallets for the first order. Can you quote private-label packaging and delivery to Rotterdam?", thread_id: "sample-additive", message_id: "sample-additive-reply-1", status: "received", step: 1, sent_at: "2026-10-10T05:15:00Z" },
], "id");

await upsert("events", [
  { id: "50000000-0000-4000-8000-000000000001", company_id: companyIds.nova, type: "company_profiled", data: { seed, sample: true, summary: "[SAMPLE] NovaLayer profile completed with high fit." }, created_at: "2026-10-08T09:00:00Z" },
  { id: "50000000-0000-4000-8000-000000000002", company_id: companyIds.proto, type: "reply_received", data: { seed, sample: true, summary: "[SAMPLE] ProtoForge requested sample-spool pricing." }, created_at: "2026-10-09T14:30:00Z" },
  { id: "50000000-0000-4000-8000-000000000003", company_id: companyIds.additive, type: "big_order_detected", data: { seed, sample: true, summary: "[SAMPLE] AdditiveWorks mentioned a twelve-pallet opportunity." }, created_at: "2026-10-10T05:15:00Z" },
  { id: "50000000-0000-4000-8000-000000000004", company_id: companyIds.maker, type: "opportunity_won", data: { seed, sample: true, summary: "[SAMPLE] MakerBridge approved an education pilot." }, created_at: "2026-10-07T11:00:00Z" },
  { id: "50000000-0000-4000-8000-000000000005", company_id: companyIds.flex, type: "email_draft_created", data: { seed, sample: true, summary: "[SAMPLE] Technical TPU outreach draft prepared." }, created_at: "2026-10-10T04:00:00Z" },
], "id");

const checks = await Promise.all([
  db.from("companies").select("id", { count: "exact", head: true }).eq("source", "sample_seed"),
  db.from("contacts").select("id", { count: "exact", head: true }).eq("verification_provider", "sample_seed"),
  db.from("products").select("sku", { count: "exact", head: true }).like("sku", "SAMPLE-%"),
  db.from("emails").select("id", { count: "exact", head: true }).like("message_id", "sample-%"),
  db.from("company_profiles").select("company_id", { count: "exact", head: true }).in("company_id", Object.values(companyIds)),
  db.from("pipeline").select("company_id", { count: "exact", head: true }).in("company_id", Object.values(companyIds)),
  db.from("catalogs").select("id", { count: "exact", head: true }).in("id", catalogIds),
  db.from("events").select("id", { count: "exact", head: true }).in("id", eventIds),
]);
for (const result of checks) if (result.error) throw result.error;

console.log(JSON.stringify({
  status: "ok",
  sampleCompanies: checks[0].count,
  sampleContacts: checks[1].count,
  sampleProducts: checks[2].count,
  sampleEmails: checks[3].count,
  sampleProfiles: checks[4].count,
  samplePipelineRows: checks[5].count,
  sampleCatalogs: checks[6].count,
  sampleEvents: checks[7].count,
  dryRun: process.env.DRY_RUN !== "false",
}, null, 2));
