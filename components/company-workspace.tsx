"use client";

import { Activity, type ReactNode, useOptimistic, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, ChartNoAxesCombined, ClipboardList, History, Mail, MessageCircle, ReceiptText } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CompanyBillingSkeleton } from "@/components/workspace-skeletons";
import { companyTab, companyTabHref, type CompanyTab } from "@/lib/company-tabs";

const sections = [
  { value: "profile", label: "Profile", icon: Building2 },
  { value: "email", label: "Email", icon: Mail },
  { value: "purchase-orders", label: "Purchase orders", icon: ClipboardList },
  { value: "analyse", label: "Analyse", icon: ChartNoAxesCombined },
  { value: "invoices", label: "Invoices", icon: ReceiptText },
  { value: "customer-portal", label: "Customer portal", icon: MessageCircle },
  { value: "history", label: "Activity history", icon: History },
] as const;

type Panels = Partial<Record<CompanyTab, ReactNode>>;

/** Server sends only the selected section. Visited panels stay mounted for drafts. */
export function CompanyWorkspace({ companyId, initialTab, toolbar, profile, section }: {
  companyId: string; initialTab: CompanyTab; toolbar: ReactNode; profile: ReactNode; section: ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useOptimistic(initialTab);
  const [pending, startTransition] = useTransition();
  const [snapshot, setSnapshot] = useState(() => ({ tab: initialTab, section, panels: initialTab === "profile" ? {} as Panels : { [initialTab]: section } as Panels }));
  // A navigation or refresh replaces only the requested server section. Other
  // panel elements retain their identity, including unsaved editor state.
  let panels = snapshot.panels;
  if (snapshot.tab !== initialTab || snapshot.section !== section) {
    panels = initialTab === "profile" ? panels : { ...panels, [initialTab]: section };
    setSnapshot({ tab: initialTab, section, panels });
  }

  function select(value: unknown) {
    const next = companyTab(value);
    if (next === activeTab) return;
    startTransition(() => {
      setActiveTab(next);
      router.replace(companyTabHref(companyId, searchParams.toString(), next), { scroll: false });
    });
  }

  return <Tabs value={activeTab} onValueChange={select} className="gap-6">
    <div className="sticky top-12 z-30 flex min-w-0 flex-col gap-3 border-b bg-background py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
      <div className="order-2 min-w-0 overflow-x-auto pb-1 sm:order-1">
        <TabsList variant="line" aria-label="Customer profile sections" className="min-w-max justify-start gap-2 lg:gap-4">
          {sections.map(({ value, label, icon: Icon }) => <TabsTrigger key={value} id={value === "profile" || value === "history" ? `company-${value}-tab` : undefined} value={value} className="gap-2 px-3"><Icon />{label}</TabsTrigger>)}
        </TabsList>
      </div>
      {toolbar}
    </div>
    <TabsContent value="profile" keepMounted><Activity mode={activeTab === "profile" ? "visible" : "hidden"}>{profile}</Activity></TabsContent>
    {sections.filter(({ value }) => value !== "profile").map(({ value }) => <TabsContent key={value} value={value} keepMounted aria-busy={pending && activeTab === value}>
      <Activity mode={activeTab === value ? "visible" : "hidden"}>{panels[value] ?? (activeTab === value ? <CompanyBillingSkeleton /> : null)}</Activity>
    </TabsContent>)}
  </Tabs>;
}
