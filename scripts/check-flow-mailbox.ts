// Checks configured SMTP/IMAP connections without sending any email.
import { createSupabaseAdmin } from "../lib/supabase/admin.ts";
import { normalizeMailboxRow } from "../lib/mailbox-utils.ts";
import { verifyMailboxConnections, type MailboxConnectionInput } from "../lib/mailbox-connection.ts";

const { data } = await createSupabaseAdmin().from("workspace_mailboxes").select("*").eq("is_default", true).throwOnError();
for (const row of data ?? []) {
  const mailbox = normalizeMailboxRow(row);
  if (!mailbox) continue;
  try {
    await verifyMailboxConnections(mailbox as MailboxConnectionInput);
    console.log(`PASS ${mailbox.type} default mailbox: SMTP and IMAP connected`);
  } catch (error) {
    console.log(`FAIL ${mailbox.type} default mailbox: ${error instanceof Error ? error.message : "Connection failed"}`);
    process.exitCode = 1;
  }
}
