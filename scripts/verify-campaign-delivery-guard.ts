// Read-only: runs the real campaign guard against saved recipients. Never queues
// operations or imports the SMTP delivery path. Requires explicit workspace/campaign IDs.
// node --env-file=.env.local --experimental-strip-types scripts/verify-campaign-delivery-guard.ts <workspace-id> <campaign-id>
import assert from "node:assert/strict";
import { z } from "zod";
import { createSupabaseAdmin } from "../lib/supabase/admin.ts";
import { withWorkspaceContext } from "../lib/workspace-context.ts";
import { workspaceRoleSchema } from "../lib/workspaces.ts";
import { assertCampaignDelivery } from "../lib/data/campaign-send-guard.ts";
import { CampaignDeliveryBlocked } from "../lib/email-send-failure.ts";
import { emailSendSchema } from "../lib/email-workbench.ts";

const [workspaceId, campaignId] = z.tuple([z.string().uuid(), z.string().uuid()]).parse(process.argv.slice(2));
await withWorkspaceContext(workspaceId, async () => {
  const db = createSupabaseAdmin();
  const { data: campaign } = await db.from("marketing_assets").select("id,dispatch").eq("id", campaignId).single().throwOnError();
  const senderId = z.string().uuid().parse(campaign.dispatch?.userId);
  const { data: member } = await db.from("workspace_members").select("role,display_name,activated_at").eq("user_id", senderId).single().throwOnError();
  assert.ok(member.activated_at, "Sender membership is inactive");
  const role = workspaceRoleSchema.parse(member.role);
  assert.notEqual(role, "viewer", "Sender cannot send campaigns");
  const viewer = { id: senderId, email: null, displayName: member.display_name, role, workspaceId, workspaceName: "Verification", ownerId: "" };
  const blocked = new Map<string, number>();
  let checked = 0, eligible = 0;
  for (let offset = 0; ; offset += 100) {
    const { data: operations } = await db.from("email_send_operations").select("id,payload").eq("campaign_id", campaignId).in("status", ["failed", "scheduled", "cancelled"]).order("id").range(offset, offset + 99).throwOnError();
    for (const operation of operations ?? []) {
      const input = emailSendSchema.parse(operation.payload);
      assert.equal(input.campaign?.id, campaignId, "Operation belongs to another campaign");
      try {
        await assertCampaignDelivery(viewer, input);
        eligible++;
      } catch (error) {
        if (!(error instanceof CampaignDeliveryBlocked)) throw error;
        blocked.set(error.message, (blocked.get(error.message) ?? 0) + 1);
      }
      checked++;
    }
    if ((operations?.length ?? 0) < 100) break;
  }
  assert.ok(checked, "No pending or failed recipients to check");
  console.log(`PASS: checked ${checked} saved recipients with the real ${role} guard; ${eligible} eligible, ${checked - eligible} blocked by current policy. No database changes or emails sent.`);
  for (const [reason, count] of blocked) console.log(`${count} blocked: ${reason}`);
});
