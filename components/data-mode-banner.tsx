import Link from "next/link";
import type { DataMode } from "@/lib/types";

export function DataModeBanner({ mode }: { mode: DataMode }) {
  if (mode === "live") return null;
  return (
    <div className="demo-banner">
      <span>DEMO DATA</span>
      <p>Supabase data stays hidden until the database, service key, authentication, and AUTH_REQUIRED=true are configured.</p>
      <Link href="/setup">Continue setup →</Link>
    </div>
  );
}
