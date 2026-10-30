// Read-only diagnosis of the reported Foxmail signature. No SMTP or provider mutations.
import { createSupabaseAdmin } from "../lib/supabase/admin.ts";
import { normalizeMailboxRow } from "../lib/mailbox-utils.ts";
import { mailboxSyncKey, loadMailboxMessageContent } from "../lib/data/mailbox-sync.ts";
import { downloadMailboxAttachment, closeMailboxSessions } from "../lib/mailbox-imap.ts";
import { detectEmailFileType, emailAttachmentHeaders } from "../lib/email-files.ts";
import assert from "node:assert/strict";
import { readCrmReceivedEmail } from "../lib/data/crm-email-content.ts";

const key = "00f7fbf4d12e9c4ae20184733f9e30b39ee22c1f5b0005b3596b717a8282c9de";
const { data } = await createSupabaseAdmin().from("workspace_mailboxes").select("*").eq("is_active", true).throwOnError();
const mailbox = (data || []).map(normalizeMailboxRow).find((mailbox) => mailbox && mailboxSyncKey(mailbox) === key);
if (!mailbox) throw new Error("Reported mailbox is unavailable.");
try {
  const email = await loadMailboxMessageContent(mailbox, 1767144035, 1);
  const image = await downloadMailboxAttachment(mailbox, 1767144035, 1, "7");
  const headers = emailAttachmentHeaders(image.filename, image.contentType, image.content);
  assert.equal(headers["Content-Type"], "image/bmp");
  assert.match(headers["Content-Disposition"], /^inline;/);
  assert.ok(email.html);
  assert.doesNotMatch(email.html, /cid:_Foxmail\.1@e92cbb9c/);
  assert.ok(email.attachments?.every((file) => !/=\?utf-8\?/i.test(file.filename)));
  const { data: member } = await createSupabaseAdmin().from("workspace_members").select("user_id,role,display_name").eq("role", "admin").not("activated_at", "is", null).limit(1).single().throwOnError();
  const crm = await readCrmReceivedEmail({ id: member.user_id, role: member.role, displayName: member.display_name, email: null }, "bf847df6-a983-4999-a113-b56d947aa87a");
  assert.ok(crm?.source);
  assert.equal(crm.email.attachments?.length, 16);
  assert.doesNotMatch(crm.email.html!, /received-attachment|mailbox=/);
  assert.ok(crm.email.attachments?.every((file) => file.url?.startsWith("/api/email/crm-attachment?")));
  const metadata = await readCrmReceivedEmail({ id: member.user_id, role: member.role, displayName: member.display_name, email: null }, "bf847df6-a983-4999-a113-b56d947aa87a", { includeContent: false });
  assert.ok(metadata?.source);
  assert.equal(metadata.email.attachments.length, 16);
  console.log(JSON.stringify({ htmlAvailable: Boolean(email.html), attachments: email.attachments?.length, genericInlineFiles: email.attachments?.filter((file) => file.cid && file.contentType === "application/octet-stream").length,
    detectedType: detectEmailFileType(image.content), displayInline: true, filenamesDecoded: true, crmOriginalRecovered: true, bytesPreserved: image.content.length }));
} finally { await closeMailboxSessions(); }
