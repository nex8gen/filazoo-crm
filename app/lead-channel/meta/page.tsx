import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { MetaLeadRefresh } from "@/components/meta-lead-refresh";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireWorkspaceMember } from "@/lib/auth";
import { env, hasSupabaseConfig } from "@/lib/env";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getBridgeSecret } from "@/lib/meta-lead-bridge";

export const metadata = { title: "Meta Leads" };

const example = JSON.stringify({
  lead_id: "MAP_META_LEAD_ID", page_id: "MAP_PAGE_ID", form_id: "MAP_FORM_ID",
  full_name: "MAP_FULL_NAME", email: "MAP_EMAIL", phone: "MAP_PHONE",
}, null, 2);

export default async function MetaLeadsPage() {
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  const isAdmin = viewer.role === "admin";
  const secret = getBridgeSecret(env.supabaseSecretKey, process.env.META_LEAD_BRIDGE_SECRET);
  const ready = Boolean(secret && secret.length >= 32 && hasSupabaseConfig());
  const callback = new URL("/api/meta/lead-bridge", env.NEXT_PUBLIC_APP_URL).toString();
  let leads: Array<{ leadgen_id: string; company_id: string | null; full_name: string | null; email: string | null; phone: string | null; form_id: string | null; ad_id: string | null; owner_id: string | null; created_at: string }> = [];
  let loadError = "";
  const ownerNames = new Map<string, string>();
  if (hasSupabaseConfig()) {
    const admin = createSupabaseAdmin();
    let query = admin.from("meta_leads").select("leadgen_id,company_id,full_name,email,phone,form_id,ad_id,owner_id,created_at").order("created_at", { ascending: false }).limit(100);
    if (viewer.role === "bd_manager") query = query.eq("owner_id", viewer.id);
    const result = await query;
    if (result.error) loadError = "Leads could not be loaded. Check the database connection and Meta lead migrations.";
    leads = result.data ?? [];
    const ids = [...new Set(leads.map((lead) => lead.owner_id).filter((id): id is string => Boolean(id)))];
    if (ids.length) {
      const { data } = await admin.from("workspace_members").select("user_id,display_name").in("user_id", ids);
      for (const owner of data ?? []) ownerNames.set(owner.user_id, owner.display_name || "BD Sales Manager");
    }
  } else loadError = "Connect the CRM database before receiving leads.";

  return <div className="space-y-6">
    <PageHeader title="Meta Leads" description="Submissions create company profiles, contacts, and pipeline leads automatically. This connection log refreshes every 15 seconds." actions={<MetaLeadRefresh />} />
    <p className="text-sm"><Link href="/companies" className="font-medium underline">Open Companies</Link> to manage Meta and Shopify leads together.</p>
    {isAdmin ? <Card>
      <CardHeader><CardTitle>Simple connection with Make</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="font-medium">{ready ? "CRM receiver configured — send a test lead to confirm the connection." : "Setup needed — leads are not connected through Make yet."}</p>
        <p>Connect Facebook once in Make, select your Page and Instant Form, then forward new leads here. You do not need to build your own Meta Developer app.</p>
        <ol className="list-decimal space-y-3 pl-5">
          <li>Copy the receiver URL and connection secret below. The CRM creates a separate connection secret automatically when its database is configured. Use your public CRM domain if the URL below shows localhost.</li>
          <li>In Make, create a scenario with <strong>Facebook Lead Ads → New Lead</strong> (instant). Sign in with Facebook and select the Page and form used by your ads. Grant Make access to that Page’s leads.</li>
          <li>Add <strong>HTTP → Make a request</strong>. Choose POST, JSON body, and the URL below. Add an <code>Authorization</code> header with <code>Bearer YOUR_CONNECTION_SECRET</code>. Keep the secret in Make’s secure credentials.</li>
          <li>Map the original lead ID and form answers using the example below. Map IDs as text. Omit optional fields when your form does not collect them. Use Get Lead Details in Make if the trigger only supplies an ID.</li>
          <li>Run once, submit a test lead, and confirm the actual name, email, and phone below. Enable the scenario to process new leads immediately. Configure Make to retry failed deliveries.</li>
        </ol>
        <div><p className="mb-1 font-medium">Receiver URL</p><code className="block break-all rounded-md bg-muted p-3">{callback}</code></div>
        {ready ? <details><summary className="cursor-pointer font-medium">Show connection secret (admin only)</summary><code className="mt-2 block break-all rounded-md bg-muted p-3">{secret}</code></details> : null}
        <details><summary className="cursor-pointer font-medium">JSON field mapping</summary><pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">{example}</pre><p className="mt-2 text-muted-foreground">Optional: ad_id, created_time (ISO timestamp), and field_data as an array of {`{ "name": "question", "values": ["answer"] }`}. Replace placeholders with mapped values; do not send the example unchanged.</p></details>
        <p className="text-muted-foreground">Use this for the B2B USA campaign’s Meta Instant Forms. Your B2B SHOPIFY FORM LEADS campaign uses the website form connection. Existing leads need a separate backfill; enabling this scenario receives new submissions.</p>
        <a href="https://apps.make.com/facebook-lead-ads" target="_blank" rel="noreferrer" className="underline">Make connection guide</a>
      </CardContent>
    </Card> : null}
    <Card><CardHeader><CardTitle>Latest submissions</CardTitle></CardHeader><CardContent>
      {loadError ? <p role="alert" className="text-sm text-destructive">{loadError}</p> : leads.length ? <div className="crm-table-frame overflow-x-auto"><table className="crm-table"><caption className="sr-only">Latest 100 Meta form submissions</caption><thead><tr className="border-b">{["Name", "Email", "Phone", "Owner", "Form / Ad", "Submitted (UTC)"].map((label) => <th key={label} scope="col" className="p-3">{label}</th>)}</tr></thead><tbody>{leads.map((lead) => <tr key={lead.leadgen_id} className="border-b"><td className="p-3">{lead.full_name || "Name not provided"}</td><td className="p-3">{lead.email || "—"}</td><td className="p-3">{lead.phone || "—"}</td><td className="p-3">{lead.owner_id ? ownerNames.get(lead.owner_id) || "Assigned" : "Unassigned"}</td><td className="p-3">{lead.form_id || "—"} / {lead.ad_id || "—"}</td><td className="whitespace-nowrap p-3">{new Date(lead.created_at).toISOString().replace("T", " ").slice(0, 19)}</td></tr>)}</tbody></table></div> : <p className="text-sm text-muted-foreground">No Meta leads received yet. Send a test submission after connecting your form.</p>}
      <p className="mt-4 text-xs text-muted-foreground">Form submissions are lead records. They do not open a Messenger conversation. <Link href="/messenger" className="underline">Open Messenger</Link></p>
    </CardContent></Card>
  </div>;
}
