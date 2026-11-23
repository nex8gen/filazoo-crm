export type PlanFeature = {
  id: string;
  label: string;
  availability?: "included" | "credits" | "connection" | "limited";
  beta?: boolean;
  note?: string;
};
export type PlanFeatureGroup = { id: string; title: string; features: PlanFeature[] };

// Customer-facing capabilities verified against the CRM routes and services.
// Do not list planned app connections as included subscription features.
export const planFeatureGroups: PlanFeatureGroup[] = [
  { id: "customers", title: "Customer management", features: [
    { id: "profiles", label: "Company and contact profiles" },
    { id: "segments", label: "Customer segments and tags" },
    { id: "pipeline", label: "Sales pipeline and lead ownership" },
    { id: "activity", label: "Customer notes and activity history" },
  ] },
  { id: "email", title: "Email and marketing", features: [
    { id: "inboxes", label: "Personal and shared email inboxes", availability: "connection" },
    { id: "email-templates", label: "Email templates and attachments" },
    { id: "campaigns", label: "Scheduled marketing campaigns", availability: "connection" },
    { id: "audiences", label: "Audience targeting and personalization" },
  ] },
  { id: "products", title: "Products, orders and billing", features: [
    { id: "variants", label: "Product variants and SKU management" },
    { id: "product-export", label: "Product catalog CSV export" },
    { id: "quotations", label: "Customer quotations and PDF export" },
    { id: "orders", label: "Draft and confirmed purchase orders" },
    { id: "shipments", label: "Shipment and fulfillment tracking" },
    { id: "invoices", label: "Invoices and payment records" },
  ] },
  { id: "automation", title: "AI and automation", features: [
    { id: "assistant", label: "AI chat and CRM actions", availability: "credits" },
    { id: "email-ai", label: "AI email drafting and reply assistance", availability: "credits" },
    { id: "research", label: "AI company tagging and research", availability: "credits" },
    { id: "discovery", label: "AI lead discovery", availability: "credits", beta: true },
    { id: "workflows", label: "Visual workflows and scheduled follow-ups" },
    { id: "run-history", label: "Workflow run history and retries" },
  ] },
  { id: "team", title: "Customer experience and teamwork", features: [
    { id: "portal-builder", label: "Customer portal builder", beta: true },
    { id: "portal-orders", label: "Customer order and invoice access", beta: true },
    { id: "documents", label: "Files, folders and text templates" },
    { id: "tasks", label: "Tasks, reminders and notifications" },
    { id: "permissions", label: "Team roles and access permissions" },
    { id: "analytics", label: "CRM analytics and report exports" },
  ] },
  { id: "connections", title: "Apps and connections", features: [
    { id: "mail-providers", label: "Gmail, NetEase and SMTP / IMAP email", availability: "connection" },
    { id: "erp", label: "Lingxing ERP inventory sync", availability: "connection" },
    // These services currently use original-workspace integration credentials:
    // lib/data/app-connections.ts and lib/data/workspace-runtime.ts.
    { id: "social", label: "Facebook, Instagram and WhatsApp messaging", availability: "limited", note: "Existing enabled workspaces only." },
    { id: "lead-integrations", label: "Shopify and Meta lead capture", availability: "limited", note: "Existing enabled workspaces only." },
  ] },
];
