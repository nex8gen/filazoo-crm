import { type CSSProperties } from "react";
import { ArrowRight, FileText, House, MessageCircle, Package, Truck } from "lucide-react";
import type { PortalDesign } from "@/lib/portal-design";

export function PortalThemeArtwork({ design }: { design: PortalDesign }) {
  return <div className="pta" data-theme={design.theme} style={{ "--pta-accent": design.accent } as CSSProperties} aria-hidden="true">
    <div className="pta-side"><div className="pta-brand"><i>{design.brandName[0]}</i><strong>{design.brandName}</strong></div><span className="is-active"><House />Home</span><span><Package />Orders</span><span><FileText />Invoices</span><span><MessageCircle />Messages</span><div className="pta-person" data-no-translate><i>AM</i>Alex Morgan</div></div>
    <div className="pta-main"><header>Home<i data-no-translate>AM</i></header><div className="pta-body"><div className="pta-stats"><span>Outstanding<strong>$1,200.00</strong><small>Due Nov 30</small></span><span>Paid<strong>$1,200.00</strong><small>of $2,400.00</small></span><span>Status<strong>Partially paid</strong><small data-no-translate>INV-001082</small></span></div><div className="pta-shortcuts"><div><Package /><strong>Orders</strong><ArrowRight /></div><div><FileText /><strong>Invoices</strong><ArrowRight /></div><div><MessageCircle /><strong>Messages</strong><ArrowRight /></div></div><div className="pta-update"><Truck /><div><span data-no-translate>PO-2048</span><strong>In transit</strong></div><small>Nov 20, 2026</small></div></div></div>
  </div>;
}
