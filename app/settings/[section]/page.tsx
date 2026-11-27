import dynamic from "next/dynamic";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { SettingsSkeleton } from "@/components/settings-skeleton";
import { requireWorkspaceMember } from "@/lib/auth";
import { settingsAliases, settingsSections } from "@/lib/settings-sections";

// Each selected section preserves its server-rendered content and saved settings.
const EmailSection = dynamic(() => import("../sections/email").then(module => module.EmailSection));
const SecuritySection = dynamic(() => import("../sections/security").then(module => module.SecuritySection));
const InvoicesSection = dynamic(() => import("../sections/invoices").then(module => module.InvoicesSection));
const TeamSection = dynamic(() => import("../sections/team").then(module => module.TeamSection));
const AiSection = dynamic(() => import("../sections/ai").then(module => module.AiSection));
const AssignmentSection = dynamic(() => import("../sections/assignment").then(module => module.AssignmentSection));
const ErpSection = dynamic(() => import("../sections/erp").then(module => module.ErpSection));

type SettingsPageProps = { params: Promise<{ section: string }> };

export default function SettingsSectionPage(props: SettingsPageProps) {
  return <Suspense fallback={<SettingsSkeleton />}><SettingsWorkspace {...props} /></Suspense>;
}

async function SettingsWorkspace({ params }: SettingsPageProps) {
  const section = (await params)?.section || "general";
  if (Object.hasOwn(settingsAliases, section)) redirect(settingsAliases[section]);
  if (!settingsSections.some(item => item.id === section)) notFound();
  const viewer = await requireWorkspaceMember(["admin", "operator", "bd_manager", "viewer"]);
  if ((section === "team" || section === "advanced" || section === "erp") && viewer.role !== "admin") notFound();

  switch (section) {
    case "email": return <EmailSection />;
    case "security": return <SecuritySection />;
    case "invoices": return <InvoicesSection viewer={viewer} />;
    case "team": return <TeamSection viewer={viewer} />;
    case "ai": return <AiSection viewer={viewer} />;
    case "advanced": return <AssignmentSection viewer={viewer} />;
    case "erp": return <ErpSection />;
    default: notFound();
  }
}
