import Link from "next/link";
import { listWorkspaceActivity } from "@/lib/data/workspace-activity";
import { getWorkspaceSettings } from "@/lib/data/workspace-settings";
import { requireWorkspaceMember } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const instant = false;
const areaLabels: Record<string, string> = { workspaces: "Workspace details", workspace_members: "Team membership", workspace_invitations: "Team invitation", workspace_mailboxes: "Mailbox connection", erp_connection_settings: "ERP connection", workspace_ai_settings: "AI access & behavior", ai_budget_policy: "AI usage limits", lead_assignment_settings: "Lead assignment" };
const fieldLabels: Record<string, string> = { name: "Workspace name", website: "Company website", logo_data_url: "Workspace logo", timezone: "Workspace timezone", business_hours: "Business hours", owner_id: "Workspace ownership", role: "Role", activated_at: "Member access", auto_assign_leads: "Lead assignment", display_name: "Display name", accepted_at: "Invitation accepted", revoked_at: "Invitation revoked", policy: "AI policy", member_limits: "Member limits", credit_only: "Credit policy", daily_micros: "Daily limit", monthly_micros: "Monthly limit", email: "Email address", provider: "Provider", is_default: "Default mailbox", is_active: "Connection status", sync_preferences: "Sync preferences", enabled: "Enabled", strategy: "Strategy", workload: "Workload", capacities: "Capacities", sync_interval: "Sync interval", warehouse_ids: "Warehouses", sku_map: "SKU mapping", worker_url: "Worker connection" };
const fieldLabel = (field: string) => fieldLabels[field] ?? (/password|secret/.test(field) ? "Credentials" : /^(smtp|imap)_/.test(field) ? "Mailbox configuration" : "Connection configuration");

export default async function WorkspaceActivityPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireWorkspaceMember(["admin"]);
  const params = await searchParams;
  const page = /^\d{1,5}$/.test(params.page ?? "") ? Math.max(1, Math.min(10000, Number(params.page))) : 1;
  const [{ entries, hasMore }, settings] = await Promise.all([listWorkspaceActivity(page), getWorkspaceSettings()]);
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: settings.timezone, dateStyle: "medium", timeStyle: "short" });
  return <div className="settings-content space-y-5">
    <Card className="shadow-none"><CardHeader><CardTitle>Workspace activity log</CardTitle><CardDescription>Administrator access only. Changes are recorded from the time activity logging was enabled.</CardDescription></CardHeader><CardContent>
      <p className="mb-5 text-xs text-muted-foreground"><span>Timezone</span>: <span data-no-translate>{settings.timezone}</span></p>
      {entries.length ? <ol className="divide-y">{entries.map(entry => <li key={entry.id} className="space-y-1 py-4 first:pt-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-sm font-medium">{entry.area === "workspaces" && entry.changed_fields.includes("owner_id") ? "Workspace ownership" : areaLabels[entry.area] ?? "Workspace settings"}<span className="ml-2 text-xs font-normal text-muted-foreground">{entry.operation === "INSERT" ? "Added" : entry.operation === "DELETE" ? "Removed" : "Updated"}</span></p><time data-no-translate dateTime={entry.created_at} className="text-xs text-muted-foreground">{formatter.format(new Date(entry.created_at))}</time></div>
        <p className="break-words text-xs text-muted-foreground"><span data-no-translate>{entry.actor_name ?? (entry.actor_id ? "Team member" : "System")}</span>{entry.target_label ? <> · <span data-no-translate>{entry.target_label}</span></> : null}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">{[...new Set(entry.changed_fields.map(fieldLabel))].map(label => <span key={label}>{label}</span>)}</div>
      </li>)}</ol> : <p className="py-4 text-sm text-muted-foreground">No workspace activity yet.</p>}
      <nav aria-label="Activity pages" className="mt-5 flex items-center justify-between gap-4 text-sm"><span>{page > 1 ? <Link href={`?page=${page - 1}`} className="text-primary hover:underline">← Newer activity</Link> : null}</span>{hasMore ? <Link href={`?page=${page + 1}`} className="text-primary hover:underline">Older activity →</Link> : null}</nav>
    </CardContent></Card>
  </div>;
}
