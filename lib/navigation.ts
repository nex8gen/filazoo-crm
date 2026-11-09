import type { ComponentType } from "react";
import { BookOpen, Building2, ChartNoAxesCombined, ClipboardList, FilePenLine, House, ListTodo, Mail, Megaphone, MessageSquareText, Package2, Settings, Sparkles, Tags, Workflow } from "lucide-react";

export type NavigationItem = {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
  badge?: string;
  exact?: boolean;
  activePrefix?: string;
  excludePrefixes?: string[];
};

export type NavigationGroup = {
  label: string;
  eyebrow: string;
  icon: ComponentType<{ className?: string }>;
  direct?: boolean;
  nested?: boolean;
  items: NavigationItem[];
};

export const navigation: NavigationGroup[] = [
  {
    label: "Home",
    eyebrow: "Workspace",
    icon: House,
    direct: true,
    items: [{ label: "Home", href: "/", icon: House, description: "Your AI workspace and sales priorities", exact: true }],
  },
  {
    label: "Companies",
    eyebrow: "Accounts",
    icon: Building2,
    items: [
      { label: "Companies", href: "/companies", icon: Building2, description: "Accounts and prospects" },
      { label: "AI Leads", href: "/lead-channel/ai-leads", icon: Sparkles, badge: "Beta", description: "Find business buyers and public contact details for your products" },
      { label: "Segments", href: "/segments", icon: Tags, description: "Companies grouped by business segment" },
    ],
  },
  {
    label: "Purchase Order",
    eyebrow: "Orders",
    icon: ClipboardList,
    nested: true,
    items: [
      { label: "Purchase Order", href: "/purchase-orders", icon: ClipboardList, description: "Customer orders, delivery and fulfillment", excludePrefixes: ["/purchase-orders/drafts"] },
      { label: "Drafts", href: "/purchase-orders/drafts", icon: FilePenLine, description: "Purchase orders awaiting confirmation" },
    ],
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
    nested: true,
    items: [
      { label: "Workflow", href: "/workflow", icon: Workflow, description: "Email follow-up workflows and automation rules", excludePrefixes: ["/workflow/marketing-assets"] },
      { label: "Marketing Assets", href: "/workflow/marketing-assets", icon: Megaphone, description: "Promotion plans, product offers and reusable marketing messages" },
    ],
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
    label: "Analytics",
    eyebrow: "CRM",
    icon: ChartNoAxesCombined,
    items: [
      { label: "Analytics", href: "/analytics", icon: ChartNoAxesCombined, description: "Performance at a glance" },
      { label: "Tasks and notifications", href: "/tasks", icon: ListTodo, description: "Assigned work, reminders and alerts" },
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
