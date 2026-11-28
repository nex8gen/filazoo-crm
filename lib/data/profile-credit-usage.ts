import "server-only";
import { requireWorkspaceMember } from "../auth.ts";
import { createSupabaseAdmin } from "../supabase/admin.ts";
import { withWorkspaceViewer } from "../workspace-context.ts";
import { creditActivityDate, creditActivityWindow } from "../profile-credit-activity.ts";

/** Own usage only. Return daily totals, never underlying request records. */
export async function readPersonalCreditUsage(now = new Date()) {
  const viewer = await requireWorkspaceMember();
  const window = creditActivityWindow(now);
  return withWorkspaceViewer(viewer, async () => {
    const db = createSupabaseAdmin();
    let usedMicros = 0;
    let pendingMicros = 0;
    const activity = new Map<string, number>();
    // Read every page: a busy member can exceed the API's default row limit.
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await db.from("ai_budget_reservations")
        .select("created_at,charged_micros,reserved_micros")
        .eq("workspace_id", viewer.workspaceId).eq("user_id", viewer.id)
        .gte("created_at", window.activityStart).lte("created_at", now.toISOString())
        .order("id").range(offset, offset + 499);
      if (error || !data) throw new Error("Unable to load personal credit usage.");
      for (const row of data) {
        const thisMonth = Date.parse(row.created_at) >= Date.parse(window.monthStart);
        if (row.charged_micros == null) {
          if (thisMonth) pendingMicros += Number(row.reserved_micros);
        } else {
          const charged = Number(row.charged_micros);
          if (thisMonth) usedMicros += charged;
          const date = creditActivityDate(row.created_at);
          activity.set(date, (activity.get(date) ?? 0) + charged);
        }
      }
      if (data.length < 500) return {
        usedMicros, pendingMicros, startDate: window.startDate, endDate: window.endDate,
        activity: Array.from(activity, ([date, usedMicros]) => ({ date, usedMicros })).sort((a, b) => a.date.localeCompare(b.date)),
      };
    }
  });
}
