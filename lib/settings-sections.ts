export const settingsSections = [
  { id: "general", title: "General", group: "Personal", href: "/settings", icon: "settings", description: "Make your everyday workspace feel right for you.", keywords: "language english chinese rows page list preferences 语言 中文 常规 列表" },
  { id: "appearance", title: "Appearance", group: "Personal", href: "/settings/appearance", icon: "sun", description: "Choose your theme, table spacing, and motion preferences.", keywords: "theme light dark system density compact motion animation accessibility 外观 主题 深色 动画" },
  { id: "profile", title: "Profile", group: "Personal", href: "/settings/profile", icon: "user", description: "Choose how you appear to people in your workspace.", keywords: "avatar photo name account 头像 姓名 个人资料" },
  { id: "security", title: "Security and login", group: "Personal", href: "/settings/security", icon: "shield", description: "Manage your password and signed-in devices.", keywords: "password session sign out devices login 安全 密码 设备 登录" },
  { id: "email", title: "Email preferences", group: "Email & connections", href: "/settings/email", icon: "mailCheck", description: "Set your reading defaults, reply assistance, and personal email footer.", keywords: "signature footer translation chinese read refresh sync AI suggestions 邮件 签名 翻译 刷新 已读" },
  { id: "mailboxes", title: "My mailbox", group: "Email & connections", href: "/settings/mailboxes", icon: "mail", description: "Connect your sales inbox and manage sending and receiving.", keywords: "personal smtp imap server default sender password 我的邮箱 发件 收件" },
  { id: "apps", title: "Apps & connections", group: "Email & connections", href: "/settings/apps", icon: "apps", description: "Manage connected apps and personal or team email accounts.", keywords: "apps integrations library gmail outlook whatsapp shopify calendar drive channels messenger meta 应用 连接 集成 渠道 团队邮箱" },
  { id: "erp", title: "ERP connection", group: "Email & connections", href: "/settings/erp", icon: "plug", description: "Connect your inventory provider and manage stock updates.", keywords: "lingxing api stock inventory warehouse credentials app secret SKU 领星 库存 仓库", adminOnly: true },
  { id: "invoices", title: "Invoice defaults", group: "Billing", href: "/settings/invoices", icon: "receipt", description: "Set the business details and defaults used on new invoices.", keywords: "seller legal business address tax currency terms payment deadline notes 发票 税率 币种 到期" },
  { id: "payments", title: "Payment methods", group: "Billing", href: "/settings/payments", icon: "creditCard", description: "Manage the payment instructions customers see on their invoices.", keywords: "bank transfer paypal beneficiary swift account 收款 银行 付款" },
  { id: "ai", title: "AI access & behavior", group: "Workspace", href: "/settings/ai", icon: "bot", description: "Control what AI can read, what it can do, and how it writes for your team.", keywords: "ai agent chat automation access permissions email writing instructions approval data privacy 人工智能 智能体 权限 自动化 邮件 设置" },
  { id: "team", title: "Team and access", group: "Workspace", href: "/settings/team", icon: "users", description: "Invite teammates, manage access, and maintain shared inboxes.", keywords: "members invite role permissions shared inbox users 团队 权限 邀请 成员", adminOnly: true },
  { id: "advanced", title: "Lead assignment", group: "Workspace", href: "/settings/advanced", icon: "workflow", description: "Review automatic lead assignment and manage eligible sales managers.", keywords: "assignment automation round robin owner manager workload 自动分配 自动化 负责人", adminOnly: true },
] as const;

export function visibleSettingsSections(isAdmin: boolean, query = "") {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return settingsSections.filter(section => (!("adminOnly" in section) || isAdmin) && terms.every(term => `${section.title} ${section.group} ${section.description} ${section.keywords}`.toLocaleLowerCase().includes(term)));
}

export function settingsSectionForPath(pathname: string) {
  return settingsSections.find(section => pathname === section.href || (section.id === "apps" && pathname.startsWith("/settings/apps/")) || (section.id === "general" && pathname === "/settings/general"));
}
