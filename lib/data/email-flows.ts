import "server-only";
import { z } from "zod";
import { requireWorkspaceMember } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import type { JsonConfig } from "../flows.ts";

const querySchema = z.object({
  recipient: z.email().transform((value) => value.toLowerCase()),
  companyId: z.uuid().optional(),
  scope: z.enum(["email", "company"]).default("email"),
});

export async function validateEmailFlowScope(config: JsonConfig) {
  const viewer = await requireWorkspaceMember();
  const admin = createSupabaseAdmin();
  const { data: company, error } = await admin.from("companies").select("id,name").eq("id", config.scopeCompanyId).maybeSingle();
  if (error) throw new Error(`Unable to load flow company: ${error.message}`);
  if (!company) throw new Error("Flow company not found.");
  if (viewer.role === "bd_manager") {
    const { data: assignment, error } = await admin.from("pipeline").select("owner_id").eq("company_id", company.id).maybeSingle();
    if (error) throw new Error(`Unable to verify company assignment: ${error.message}`);
    if (assignment?.owner_id !== viewer.id) throw new Error("Access denied.");
  }
  if (config.flowScope === "email") {
    const { data: contact, error } = await admin.from("contacts").select("id,email").eq("id", config.scopeContactId).eq("company_id", company.id).maybeSingle();
    if (error) throw new Error(`Unable to load flow contact: ${error.message}`);
    if (!contact) throw new Error("The email contact no longer belongs to this company.");
    return { ...config, scopeLabel: contact.email };
  }
  return { ...config, scopeLabel: company.name };
}

export async function resolveEmailFlowScope(input: unknown) {
  await requireWorkspaceMember();
  const parsed = querySchema.parse(input);
  // Escape ILIKE metacharacters so this always resolves one exact address.
  const address = parsed.recipient.replace(/[\\%_]/g, "\\$&");
  let query = createSupabaseAdmin().from("contacts").select("id,company_id,email").ilike("email", address);
  if (parsed.companyId) query = query.eq("company_id", parsed.companyId);
  const { data: contacts, error } = await query.limit(2);
  if (error) throw new Error(`Unable to load email contact: ${error.message}`);
  if (contacts?.length !== 1) throw new Error("Save this email as a contact on one company before creating its automation flow.");
  const contact = contacts[0];
  return validateEmailFlowScope({
    flowScope: parsed.scope,
    scopeCompanyId: contact.company_id,
    ...(parsed.scope === "email" ? { scopeContactId: contact.id } : {}),
  });
}
