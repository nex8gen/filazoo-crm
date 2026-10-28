export type Category = "Communication" | "Sales & inventory" | "Productivity" | "Automation";
export type ConnectionApp = {
  id: string;
  name: string;
  category: Category;
  description: string;
  keywords?: string;
  logo: string;
  availability: "existing" | "planned";
  scope: "Personal" | "Workspace";
  method: string;
  details: string;
  features: string[];
  adminOnly?: boolean;
};

export const connectionApps: ConnectionApp[] = [
  {
    id: "netease-mail", name: "网易灵犀办公", category: "Communication", logo: "/app-logos/netease-lingxi.svg",
    description: "Connect your NetEase Lingxi Office business email to the CRM.",
    keywords: "163 netease lingxi mail.qiye.163.com 网易 企业邮箱 灵犀 办公",
    availability: "existing", scope: "Personal", method: "IMAP / SMTP with a client authorization password",
    details: "Connect your Lingxi Office mailbox using the client authorization password from your email account settings.",
    features: ["Read and reply from the CRM inbox", "Connect your company email address", "Keep existing personal and shared accounts in place"],
  },
  {
    id: "gmail", name: "Gmail", category: "Communication", logo: "/app-logos/gmail.svg",
    description: "Keep customer emails and sales conversations in one place.",
    availability: "existing", scope: "Personal", method: "SMTP / IMAP with an app password",
    details: "Connect your Gmail or Google Workspace mailbox using a Google app password. The CRM checks sending and receiving before saving your connection.",
    features: ["Read and reply from the CRM inbox", "Choose your sending mailbox", "Keep personal mailbox access private"],
  },
  {
    id: "outlook", name: "Microsoft Outlook", category: "Communication", logo: "/app-logos/outlook.svg",
    description: "Bring your Microsoft email account into your sales workflow.",
    availability: "planned", scope: "Personal", method: "Microsoft sign-in (planned)",
    details: "A dedicated Microsoft connection is planned. The existing manual mailbox form remains available for accounts whose provider supports its SMTP / IMAP authentication method; Microsoft sign-in is not implemented yet.",
    features: ["Planned: connect with Microsoft", "Planned: sync customer email conversations", "Planned: manage account permissions and reconnect"],
  },
  {
    id: "whatsapp", name: "WhatsApp Business", category: "Communication", logo: "/app-logos/whatsapp.svg",
    description: "Follow up with customers from the shared messaging inbox.",
    availability: "existing", scope: "Workspace", method: "Twilio WhatsApp connection",
    details: "The existing Messenger workspace shows WhatsApp connection readiness and conversations. An administrator configures the business sender through Twilio; this preview does not register a phone number.",
    features: ["View WhatsApp conversations", "Reply through the existing messaging connection", "Check channel readiness in Messenger"],
  },
  {
    id: "facebook", name: "Facebook Messenger", category: "Communication", logo: "/app-logos/facebook.svg",
    description: "Keep Facebook Page conversations close to your customer records.",
    availability: "existing", scope: "Workspace", method: "Existing Meta / Twilio messaging connection",
    details: "Open Messenger to review the existing Facebook channel and its connection requirements. Guided Facebook sign-in is not part of this preview.",
    features: ["Read Facebook customer conversations", "Reply from the messaging workspace", "Review channel configuration and errors"],
  },
  {
    id: "instagram", name: "Instagram", category: "Communication", logo: "/app-logos/instagram.svg",
    description: "Bring Instagram customer messages into the team inbox.",
    availability: "existing", scope: "Workspace", method: "Existing Meta messaging connection",
    details: "The Messenger workspace includes the existing Instagram channel. Its administrator-configured account and Meta permissions are required before messages can be received or sent.",
    features: ["View Instagram customer conversations", "Reply from the unified inbox", "Review Instagram channel readiness"],
  },
  {
    id: "lingxing", name: "Lingxing ERP", category: "Sales & inventory", logo: "/app-logos/lingxing.ico",
    description: "Bring warehouse stock and product availability into the CRM.",
    availability: "existing", scope: "Workspace", method: "App ID and App Secret", adminOnly: true,
    details: "Connect Lingxing, select warehouses, map SKUs, and schedule inventory updates. Inventory is a read-only ERP snapshot.",
    features: ["Map CRM products to ERP SKUs", "Choose warehouses and sync intervals", "Test the connection and refresh stock"],
  },
  {
    id: "shopify", name: "Shopify", category: "Sales & inventory", logo: "/shopify-mark.svg",
    description: "Turn store enquiries into customer profiles and sales leads.",
    availability: "existing", scope: "Workspace", method: "Existing store form and customer webhooks",
    details: "The current Shopify integration receives supported B2B form and tagged customer leads. Store credentials and webhook setup are managed by an administrator. A store connection wizard and order syncing are planned.",
    features: ["Receive supported store enquiries", "Create company and contact records", "Assign new leads through existing CRM rules"],
  },
  {
    id: "meta-leads", name: "Meta Lead Ads", category: "Sales & inventory", logo: "/meta-mark.svg",
    description: "Collect Facebook and Instagram form leads for your sales team.",
    availability: "existing", scope: "Workspace", method: "Make lead bridge",
    details: "Use the existing Meta Leads page to review incoming submissions. Administrators can access the Make connection instructions and send a test lead through their configured scenario.",
    features: ["Receive Meta Instant Form submissions", "Create CRM company and contact records", "Review incoming leads and assignments"],
  },
  {
    id: "google-calendar", name: "Google Calendar", category: "Productivity", logo: "/app-logos/google-calendar.svg",
    description: "Schedule customer meetings and keep follow-ups on your calendar.",
    availability: "planned", scope: "Personal", method: "Google sign-in (planned)",
    details: "Calendar connectivity is planned. This preview does not request calendar access or create any events.",
    features: ["Planned: choose a calendar", "Planned: create customer meetings", "Planned: link appointments to customer records"],
  },
  {
    id: "outlook-calendar", name: "Outlook Calendar", category: "Productivity", logo: "/app-logos/outlook.svg",
    description: "Keep Microsoft meetings connected to your customer follow-ups.",
    availability: "planned", scope: "Personal", method: "Microsoft sign-in (planned)",
    details: "Outlook Calendar is planned as a separate permission within the Microsoft connection. No calendar access is requested in this preview.",
    features: ["Planned: choose a Microsoft calendar", "Planned: schedule customer appointments", "Planned: link meetings to CRM records"],
  },
  {
    id: "google-drive", name: "Google Drive", category: "Productivity", logo: "/app-logos/google-drive.svg",
    description: "Keep quotations, contracts, and product documents within reach.",
    availability: "planned", scope: "Personal", method: "Google sign-in (planned)",
    details: "A Google Drive file picker is planned so you can select documents to associate with CRM records. This preview does not access your files.",
    features: ["Planned: choose files from Drive", "Planned: attach document links to customers", "Planned: organize sales reference documents"],
  },
  {
    id: "onedrive", name: "Microsoft OneDrive", category: "Productivity", logo: "/app-logos/onedrive.svg",
    description: "Connect customer records with your Microsoft sales documents.",
    availability: "planned", scope: "Personal", method: "Microsoft sign-in (planned)",
    details: "OneDrive connectivity is planned. You will be able to select relevant customer documents once the connector is implemented.",
    features: ["Planned: select OneDrive documents", "Planned: link quotations and contracts", "Planned: manage document access permissions"],
  },
  {
    id: "make", name: "Make", category: "Automation", logo: "/app-logos/make.svg",
    description: "Send Meta form leads into the CRM with an automated scenario.",
    availability: "existing", scope: "Workspace", method: "Meta lead bridge webhook", adminOnly: true,
    details: "The existing Make setup supports the Meta lead bridge. It is not a general-purpose connector for every CRM action. Open the setup guide to configure the scenario and field mapping.",
    features: ["Forward Meta Lead Ads submissions", "Map lead fields to CRM contacts", "Use the existing authenticated receiver"],
  },
  {
    id: "zapier", name: "Zapier", category: "Automation", logo: "/app-logos/zapier.svg",
    description: "Connect more business tools with event-based automations.",
    availability: "planned", scope: "Workspace", method: "CRM triggers and actions (planned)",
    details: "A dedicated Zapier connection is planned. This preview does not publish CRM triggers, accept Zapier credentials, or create automations.",
    features: ["Planned: trigger workflows from new CRM leads", "Planned: create contacts from other tools", "Planned: track automation deliveries"],
  },
];


export const appCategories: Category[] = ["Communication", "Sales & inventory", "Productivity", "Automation"];
