import type { LucideIcon } from "lucide-react";
import { Activity, BookOpen, Building2, ClipboardList, FileText, FolderOpen, Globe2, Mail, MessageCircle, Package, Search, Send, ShieldCheck, Sparkles, Tags, Workflow } from "lucide-react";

export const categories = ["All features", "Find & connect", "Sell & deliver", "Work smarter"] as const;
export type Category = typeof categories[number];
export const features: { title: string; text: string; icon: LucideIcon; category: Category; beta?: boolean }[] = [
  { title: "AI lead discovery", text: "Discover potential business buyers and public contact details for your products.", icon: Search, category: "Find & connect", beta: true },
  { title: "Company intelligence", text: "Research companies, keep customer profiles, and bring contacts and conversation history together.", icon: Building2, category: "Find & connect" },
  { title: "Connected email", text: "Manage connected mailboxes, read conversations, translate messages, and prepare AI-assisted replies.", icon: Mail, category: "Find & connect" },
  { title: "Segments & ownership", text: "Group customers by segment and assign accounts so every relationship has a clear owner.", icon: Tags, category: "Find & connect" },
  { title: "Messenger & lead channels", text: "Bring in Meta ad leads and Shopify inquiries, and manage Facebook Page conversations.", icon: MessageCircle, category: "Find & connect", beta: true },
  { title: "Products & pricing", text: "Keep product variants, quantity-based pricing, and availability in your sales workspace.", icon: Package, category: "Sell & deliver" },
  { title: "Catalogs & quotations", text: "Match products to buyers, generate catalog PDFs, and create customer-specific quotations.", icon: BookOpen, category: "Sell & deliver" },
  { title: "Purchase orders", text: "Turn customer offers into orders and keep drafts, delivery, and fulfillment organized.", icon: ClipboardList, category: "Sell & deliver" },
  { title: "Invoices & payments", text: "Prepare draft and commercial invoices, share invoice PDFs, and record customer payments.", icon: FileText, category: "Sell & deliver" },
  { title: "Customer websites", text: "Build a customer-facing website with themes, custom domains, and customer account access.", icon: Globe2, category: "Sell & deliver", beta: true },
  { title: "AI workspace assistant", text: "Research, draft, and work with your CRM using an assistant that respects customer access permissions.", icon: Sparkles, category: "Work smarter" },
  { title: "Follow-up workflows", text: "Build triggers, waits, conditions, AI replies, assigned tasks, and alerts in a visual workflow.", icon: Workflow, category: "Work smarter" },
  { title: "Campaigns & promotions", text: "Plan promotional emails, organize offers, and prepare campaign content for review.", icon: Send, category: "Work smarter" },
  { title: "Files & templates", text: "Organize business documents, preview PDFs, and reuse email templates and attachments.", icon: FolderOpen, category: "Work smarter" },
  { title: "Tasks & analytics", text: "Track sales activity, review workspace performance, and keep assigned work and reminders visible.", icon: Activity, category: "Work smarter" },
  { title: "Team & access controls", text: "Collaborate in separate workspaces with roles, customer assignment, and visible AI usage.", icon: ShieldCheck, category: "Work smarter" },
];
export const faqs = [
  ["Who is NewAI built for?", "NewAI is built for B2B sales teams, suppliers, and growing businesses that manage company relationships, product catalogs, and customer conversations. It connects the work from finding a potential buyer to preparing a quotation and managing an order."],
  ["Can I use my existing business email?", "Yes. You can connect supported business mailboxes using SMTP and IMAP. NewAI brings email conversations into your workspace, with translation, templates, attachments, and AI-assisted writing."],
  ["What can the AI help with?", "The AI can help research businesses, discover leads, summarize conversations, draft replies, match products, and assist with CRM actions. Availability depends on your workspace settings, connected services, and AI credits. Review drafts and proposed changes before using them; enabled automation follows the workflow you configure."],
  ["How is customer access controlled?", "Workspaces separate your business data. Non-admin team members can give AI access only to their currently assigned customers and those customers’ conversations. Administrators can allow access across their current workspace, subject to AI data settings."],
  ["Can I automate follow-ups?", "Yes. Use the visual workflow builder to combine triggers, waiting periods, conditions, AI-assisted replies, tasks, and alerts. You can preview workflows before activation. Live email actions require an eligible recipient and a connected sending mailbox."],
  ["How do I get started?", "Create an account, set up a workspace, and connect the tools you need. You can review current workspace access and AI credit options in the app before purchasing. Features marked Beta are still evolving."],
];
