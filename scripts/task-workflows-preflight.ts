// Read-only network checks. This script has no mutation, mail-send or worker calls.
import assert from "node:assert/strict";
import { createSupabaseAdmin } from "../lib/supabase/admin";
import { normalizeMailboxRow } from "../lib/mailbox-utils";
import { invoiceProduct } from "../lib/invoice-links";
import { userProductRows } from "../lib/data/product-personalization";
async function main() {
  const db = createSupabaseAdmin();
  const [{ data: sender }, { data: member }] = await Promise.all([
    db.from("workspace_mailboxes").select("*").eq("type", "workspace").eq("is_default", true).eq("is_active", true).single().throwOnError(),
    db.from("workspace_members").select("user_id").eq("role", "admin").eq("display_name", "Sourav Mallick").not("activated_at", "is", null).single().throwOnError(),
  ]);
  const mailbox = normalizeMailboxRow(sender);
  assert.equal(mailbox?.email?.toLowerCase(), "raul@filazoo.com");
  assert.ok(mailbox?.smtpHost && mailbox.imapHost);
  const products = (await userProductRows(member.user_id)).filter(row => row.active && Number(row.price) > 0);
  assert.ok(products.length);
  const product = invoiceProduct({ ...products[0], tags: products[0].tags ?? [] });
  console.log(JSON.stringify({ connectedDatabase: true, intendedTestDestination: mailbox.email, mailboxConfigured: true,
    testProduct: { sku: product.sku, variantId: product.variants[0]?.id ?? null, quantity: Math.max(1, product.moq) }, noWrites: true, noEmailsSent: true }));
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
