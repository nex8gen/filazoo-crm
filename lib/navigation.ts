import type { ComponentType } from "react";
import { BookOpen, Building2, ChartNoAxesCombined, LayoutDashboard, ListTodo, Mail, MessageSquareText, Package2, ReceiptText, Settings, Tags } from "lucide-react";
import { AiIcon } from "@/components/ai-icon";

export type NavigationItem = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
  exact?: boolean;
};

export type NavigationGroup = {
  label: string;
  eyebrow: string;
  icon: ComponentType<{ className?: string }>;
  direct?: boolean;
  items: NavigationItem[];
};

export const navigation: NavigationGroup[] = [
  {
    label: "Overview",
    eyebrow: "CRM",
    icon: LayoutDashboard,
    items: [
      { label: "Analytics", href: "/", icon: ChartNoAxesCombined, description: "Performance at a glance" },
      { label: "Tasks and notifications", href: "/tasks", icon: ListTodo, description: "Assigned work, reminders and alerts" },
    ],
  },
  {
    label: "Companies",
    eyebrow: "Accounts",
    icon: Building2,
    items: [
      { label: "Company", href: "/companies", icon: Building2, description: "Accounts and prospects" },
      { label: "Segment", href: "/segments", icon: Tags, description: "Companies grouped by business segment" },
    ],
  },
  {
    label: "Invoices",
    eyebrow: "Billing",
    icon: ReceiptText,
    direct: true,
    items: [{ label: "Invoices", href: "/invoices", icon: ReceiptText, description: "Billing, balances and payments" }],
  },
  {
    label: "Email",
    eyebrow: "Mailbox",
    icon: Mail,
    direct: true,
    items: [{ label: "Email", href: "/emails", icon: Mail, description: "Mailbox and email conversations" }],
  },
  {
    label: "Messenger",
    eyebrow: "Engagement",
    icon: MessageSquareText,
    direct: true,
    items: [{ label: "Messenger", href: "/messenger", icon: MessageSquareText, description: "Facebook ad leads and Page Messenger replies" }],
  },
  {
    label: "AI Automation",
    eyebrow: "Automation",
    icon: AiIcon,
    direct: true,
    items: [{ label: "AI Automation", href: "/lead-channel/ai-agent", icon: AiIcon, description: "Email follow-up flows and automation rules" }],
  },
  {
    label: "Products",
    eyebrow: "Product management",
    icon: Package2,
    items: [
      { label: "Products", href: "/catalogs", icon: Package2, description: "Products, pricing and availability", exact: true },
      { label: "Company Catalogs", href: "/catalogs/companies", icon: BookOpen, description: "Tailored selections for each company" },
    ],
  },
  {
    label: "Settings",
    eyebrow: "Configuration",
    icon: Settings,
    direct: true,
    items: [{ label: "General", href: "/settings", icon: Settings, description: "Profile, security and team" }],
  },
];
