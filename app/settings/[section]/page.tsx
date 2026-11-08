import dynamic from "next/dynamic";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { SettingsSkeleton } from "@/components/settings-skeleton";
import { requireWorkspaceMember } from "@/lib/auth";
import { settingsAliases, settingsSections } from "@/lib/settings-sections";
import { GeneralSettings } from "../general-settings";

// Each selected section preserves its server-rendered content and saved settings.
// General has a separate route entry so these form imports stay out of its shell.
const AppearanceSection = dynamic(() => import("../sections/appearance").then(module => module.AppearanceSection));
const EmailSection = dynamic(() => import("../sections/email").then(module => module.EmailSection));
const ProfileSection = dynamic(() => import("../sections/profile").then(module => module.ProfileSection));
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
    case "general": return <GeneralSettings />;
    case "appearance": return <AppearanceSection />;
    case "email": return <EmailSection />;
    case "profile": return <ProfileSection viewer={viewer} />;
    case "security": return <SecuritySection viewer={viewer} />;
    case "invoices": return <InvoicesSection viewer={viewer} />;
    case "team": return <TeamSection viewer={viewer} />;
    case "ai": return <AiSection viewer={viewer} />;
    case "advanced": return <AssignmentSection viewer={viewer} />;
    case "erp": return <ErpSection />;
    default: notFound();
  }
}
