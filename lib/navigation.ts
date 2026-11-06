import type { ComponentType } from "react";
import { BookOpen, Building2, ChartNoAxesCombined, ClipboardList, LayoutDashboard, ListTodo, Mail, MessageSquareText, Package2, Settings, Tags, Workflow } from "lucide-react";

export type NavigationItem = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
  exact?: boolean;
  activePrefix?: string;
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
      { label: "Analytics", href: "/analytics", icon: ChartNoAxesCombined, description: "Performance at a glance" },
      { label: "My Day", href: "/my-day", icon: ListTodo, description: "Your daily priorities and next actions" },
      { label: "Tasks and notifications", href: "/tasks", icon: ListTodo, description: "Assigned work, reminders and alerts" },
    ],
  },
  {
    label: "Companies",
    eyebrow: "Accounts",
    icon: Building2,
    items: [
      { label: "Companies", href: "/companies", icon: Building2, description: "Accounts and prospects" },
      { label: "Segments", href: "/segments", icon: Tags, description: "Companies grouped by business segment" },
    ],
  },
  {
    label: "Purchase orders",
    eyebrow: "Orders",
    icon: ClipboardList,
    direct: true,
    items: [{ label: "Purchase orders", href: "/purchase-orders", icon: ClipboardList, description: "Customer orders, delivery and fulfillment" }],
  },
  {
    label: "Email",
    eyebrow: "Mailbox",
    icon: Mail,
    direct: true,
    items: [{ label: "Email", href: "/email", icon: Mail, description: "Mailbox and email conversations" }],
  },
  {
    label: "Messenger",
    eyebrow: "Engagement",
    icon: MessageSquareText,
    direct: true,
    items: [{ label: "Messenger", href: "/messenger", icon: MessageSquareText, description: "Facebook ad leads and Page Messenger replies" }],
  },
  {
    label: "Workflow",
    eyebrow: "Workflow",
    icon: Workflow,
    direct: true,
    items: [{ label: "Workflow", href: "/workflow", icon: Workflow, description: "Email follow-up workflows and automation rules" }],
  },
  {
    label: "Products",
    eyebrow: "Product management",
    icon: Package2,
    items: [
      { label: "Products", href: "/products", icon: Package2, description: "Products, pricing and availability" },
      { label: "Company Quotations", href: "/company-quotations", icon: BookOpen, description: "Customer offers, versions and draft orders" },
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
