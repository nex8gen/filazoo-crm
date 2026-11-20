import { CircleAlert, Clock3 } from "lucide-react";
import { tagHealthLabel, type TagProcessingStatus } from "@/lib/customer-tag-rules";

export function CustomerTagHealth({ status, reason }: { status?: TagProcessingStatus; reason?: string }) {
  const label = tagHealthLabel(status);
  if (!label) return null;
  const Icon = status === "pending" ? Clock3 : CircleAlert;
  return <span role="status" title={reason || label} className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground">
    <Icon aria-hidden="true" className="size-3" />{label}
  </span>;
}
