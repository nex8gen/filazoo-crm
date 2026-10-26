import { Building2, FileText, LayoutGrid, Mail, MessageCircle, Package } from "lucide-react";
import type { AgentWorkArea } from "@/lib/ai/agent-progress";

const icons = { invoice: FileText, email: Mail, message: MessageCircle, company: Building2, product: Package, workspace: LayoutGrid };

export function AgentWorkIcon({ area, className = "size-3.5 shrink-0" }: { area: AgentWorkArea; className?: string }) {
  const Icon = icons[area];
  return <Icon aria-hidden="true" className={className} />;
}
