import type { ComponentType } from "react";
import { BookOpen, Building2, ChartColumnIncreasing, ClipboardList, FilePenLine, FolderOpen, House, ListTodo, Mail, Megaphone, MessageSquare, Package, Settings, Sparkles, Tags, Workflow } from "lucide-react";

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
  sectionStart?: boolean;
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
    label: "Email",
    eyebrow: "Mailbox",
    icon: Mail,
    direct: true,
    items: [
      { label: "Email", href: "/email", icon: Mail, description: "Mailbox and email conversations", excludePrefixes: ["/email/campaigns"] },
    ],
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
    label: "Products",
    eyebrow: "Product management",
    icon: Package,
    items: [
      { label: "Products", href: "/products", icon: Package, description: "Products, pricing and availability" },
      { label: "Company Quotations", href: "/company-quotations", icon: BookOpen, description: "Customer offers, versions and draft orders" },
    ],
  },
  {
    label: "Files & templates",
    sectionStart: true,
    eyebrow: "Library",
    icon: FolderOpen,
    direct: true,
    items: [{ label: "Files & templates", href: "/documents", icon: FolderOpen, description: "Find files, organize folders and reuse text templates" }],
  },
  {
    label: "Marketing campaigns",
    eyebrow: "Marketing",
    icon: Megaphone,
    direct: true,
    items: [{ label: "Marketing campaigns", href: "/email/campaigns", icon: Megaphone, description: "Plan promotional emails, offers and campaign dates" }],
  },
  {
    label: "Purchase Order",
    sectionStart: true,
    eyebrow: "Orders",
    icon: ClipboardList,
    nested: true,
    items: [
      { label: "Purchase Order", href: "/purchase-orders", icon: ClipboardList, description: "Customer orders, delivery and fulfillment", excludePrefixes: ["/purchase-orders/drafts"] },
      { label: "Drafts", href: "/purchase-orders/drafts", icon: FilePenLine, description: "Purchase orders awaiting confirmation" },
    ],
  },
  {
    label: "Messenger",
    eyebrow: "Engagement",
    icon: MessageSquare,
    direct: true,
    items: [{ label: "Messenger", href: "/messenger", icon: MessageSquare, description: "Facebook ad leads and Page Messenger replies" }],
  },
  {
    label: "Workflow",
    eyebrow: "Workflow",
    icon: Workflow,
    direct: true,
    items: [{ label: "Workflow", href: "/workflow", icon: Workflow, description: "Email follow-up workflows and automation rules" }],
  },
  {
    label: "Analytics",
    sectionStart: true,
    eyebrow: "CRM",
    icon: ChartColumnIncreasing,
    items: [
      { label: "Analytics", href: "/analytics", icon: ChartColumnIncreasing, description: "Performance at a glance" },
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
