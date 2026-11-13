import Link from "next/link";
import { NotificationToast } from "@/components/ui/notification-toast";
import type { DataMode } from "@/lib/types";

export function DataModeBanner({ mode }: { mode: DataMode }) {
  if (mode === "live") return null;
  return (
    <NotificationToast tone="warning" preserve>
      <span>CRM OFFLINE</span>
      <p>Live CRM records stay unavailable until the database, service key, authentication, and AUTH_REQUIRED=true are configured.</p>
      <Link href="/setup">Continue setup →</Link>
    </NotificationToast>
  );
}
