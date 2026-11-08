export const settingsSections = [
  { id: "general", title: "General", group: "Personal", href: "/settings", icon: "settings", description: "Choose your language, start page, and list preferences. These choices apply only to you.", keywords: "language english chinese rows page list preferences landing home login 语言 中文 常规 列表 首页" },
  { id: "appearance", title: "Appearance", group: "Personal", href: "/settings/appearance", icon: "sun", description: "Choose your theme, table spacing, and motion preferences.", keywords: "theme light dark system density compact motion animation accessibility 外观 主题 深色 动画" },
  { id: "profile", title: "Profile", group: "Personal", href: "/settings/profile", icon: "user", description: "Choose how you appear to people in your workspace.", keywords: "avatar photo name account 头像 姓名 个人资料" },
  { id: "security", title: "Security and login", group: "Personal", href: "/settings/security", icon: "shield", description: "Manage your password and signed-in devices.", keywords: "password session sign out devices login 安全 密码 设备 登录" },
  { id: "email", title: "Email preferences", group: "Personal", href: "/settings/email", icon: "mailCheck", description: "Set your reading defaults, reply assistance, and personal email footer.", keywords: "signature footer translation chinese read refresh sync AI suggestions 邮件 签名 翻译 刷新 已读" },
  { id: "workspace", title: "Workspace", group: "Workspace", href: "/settings/workspace", icon: "users", description: "Manage workspace details, ownership, and membership.", keywords: "organization company workspace switch owner leave 工作区 所有权" },
  { id: "ai", title: "AI access & behavior", group: "Workspace", href: "/settings/ai", icon: "bot", description: "Control what AI can read, what it can do, and how it writes for your team.", keywords: "ai agent chat automation access permissions email writing instructions approval data privacy users budget spending usage limits 人工智能 预算 用量 智能体 权限 自动化 邮件 设置" },
  { id: "team", title: "Team and access", group: "Workspace", href: "/settings/team", icon: "users", description: "Invite teammates, review roles, and manage workspace membership.", keywords: "members invite role permissions users 团队 权限 邀请 成员", adminOnly: true },
  { id: "advanced", title: "Lead assignment", group: "Workspace", href: "/settings/advanced", icon: "workflow", description: "Review automatic lead assignment and manage eligible sales managers.", keywords: "assignment automation round robin owner manager workload 自动分配 自动化 负责人", adminOnly: true },
  { id: "apps", title: "Apps & connections", group: "Connections", href: "/settings/apps", icon: "apps", description: "Connect apps and manage personal and team email accounts in one place.", keywords: "apps integrations library gmail outlook whatsapp shopify channels messenger meta smtp imap server sender mailbox default personal team 应用 连接 集成 渠道 团队邮箱 我的邮箱 发件 收件" },
  { id: "erp", title: "ERP connection", group: "Connections", href: "/settings/erp", icon: "plug", description: "Connect your inventory provider and manage stock updates.", keywords: "lingxing api stock inventory warehouse credentials app secret SKU 领星 库存 仓库", adminOnly: true },
  { id: "invoices", title: "Invoices and payments", group: "Billing", href: "/settings/invoices", icon: "receipt", description: "Manage seller details, new-invoice defaults, and customer payment methods. Admins and operators can make changes.", keywords: "seller legal business address tax currency terms payment deadline notes bank transfer paypal beneficiary swift account 发票 税率 币种 到期 收款 银行 付款" },
] as const;

export const settingsGroups = ["Personal", "Workspace", "Connections", "Billing"] as const;

// Retain bookmarks and links from older CRM screens without duplicating editors.
export const settingsAliases: Record<string, string> = {
  general: "/settings",
  integrations: "/settings/apps",
  mailboxes: "/settings/apps?view=personal",
  payments: "/settings/invoices#payment-methods",
};

export function visibleSettingsSections(isAdmin: boolean, query = "") {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return settingsSections.filter(section => (!("adminOnly" in section) || isAdmin) && terms.every(term => `${section.title} ${section.group} ${section.description} ${section.keywords}`.toLocaleLowerCase().includes(term)));
}

export function settingsSectionForPath(pathname: string) {
  const key = pathname.split("/")[2];
  const alias = Object.hasOwn(settingsAliases, key) ? settingsAliases[key] : undefined;
  if (alias) pathname = alias.split(/[?#]/)[0];
  return settingsSections.find(section => pathname === section.href || (section.id === "apps" && pathname.startsWith("/settings/apps/")) || (section.id === "general" && pathname === "/settings/general"));
}
