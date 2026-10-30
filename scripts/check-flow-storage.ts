import { createSupabaseAdmin } from "../lib/supabase/admin.ts";
import { randomUUID } from "node:crypto";
const admin = createSupabaseAdmin();
const { data: member } = await admin.from("workspace_members").select("user_id").eq("role", "admin").limit(1).single().throwOnError();
const path = `${member!.user_id}/${randomUUID()}/workflow-storage-probe.txt`;
const result = await admin.storage.from("mailbox-attachments").upload(path, Buffer.from("Workflow storage verification"), { contentType: "text/plain" });
if (result.error) {
  console.log(JSON.stringify(result.error, Object.getOwnPropertyNames(result.error), 2));
  process.exitCode = 1;
} else {
  console.log("PASS attachment storage upload");
  const removed = await admin.storage.from("mailbox-attachments").remove([path]);
  if (removed.error) throw removed.error;
  console.log("PASS disposable storage probe removed");
}
