import { zhCNAdditional } from "./i18n-zh-cn.ts";
import { zhCNSettings } from "./i18n-settings.ts";

export type AppLanguage = "en" | "zh-CN";

export const LANGUAGE_STORAGE_KEY = "filazoo-language";

// Product terminology is centralized so sales, catalog, mailbox, and
// automation screens use consistent professional Chinese wording.
const zhCN: Record<string, string> = {
  "Bulk flow actions": "流程批量操作",
  "Clear selection": "清除选择",
  "Select all editable flows on this page": "选择本页所有可编辑流程",
  "Select up to 100 flows at a time.": "每次最多选择 100 个流程。",
  "Delete selected flows?": "删除所选流程？",
  "Delete the selected flows and their run history? This cannot be undone.": "删除所选流程及其运行历史记录？此操作无法撤销。",
  "Selected flows deleted.": "已删除所选流程。",
  "Selected flows turned on.": "已启用所选流程。",
  "Selected flows paused.": "已暂停所选流程。",
  "Some flows could not be updated. Review the errors below.": "部分流程未能更新，请查看下方错误信息。",
  "Unable to update flows.": "无法更新流程。",
  "Another flow action is in progress.": "另一项流程操作正在进行中。",
  "All workspace flows. Select a flow to view its canvas and configuration.": "工作区的所有流程。选择流程以查看画布和配置。",
  "Shared flow is read-only. Its creator or an administrator can change it.": "共享流程为只读，创建者或管理员可以修改。",
  "Created by": "创建者",
  "you": "您",
  "Workspace member": "工作区成员",
  "Accepted by mail server:": "邮件服务器已接收：",
  "Actual emails and catalog attachments will be sent to this address.": "实际邮件和产品目录附件将发送到此地址。",
  "Cancel delivery test": "取消发送测试",
  "Next email:": "下一封邮件：",
  "Real delivery test": "实际发送测试",
  "Send real test emails": "发送实际测试邮件",
  "Start another test": "开始新的测试",
  "Test recipient email": "测试收件邮箱",
  "Test the current flow before turning it on. Send a real reply to your test inbox, or generate a preview.": "启用前测试当前流程。向测试邮箱发送实际回复，或生成预览。",
  "Add image": "添加图片", "Attach images": "添加图片附件", "Reading image…": "正在读取图片…", "Preparing image…": "正在处理图片…",
  "Attach images (JPG, PNG or WebP, up to 10 MB each)": "添加图片（JPG、PNG 或 WebP，每张不超过 10 MB）",
  "Add up to 4 images at a time.": "每次最多添加 4 张图片。",
  "Choose a JPG, PNG or WebP image.": "请选择 JPG、PNG 或 WebP 图片。",
  "Use a JPG, PNG or WebP image.": "请使用 JPG、PNG 或 WebP 图片。",
  "Choose images smaller than 10 MB.": "请选择小于 10 MB 的图片。",
  "Unable to read this image. Try adding it again.": "无法读取此图片，请重新添加。",
  "This image could not be opened. Choose another JPG, PNG or WebP image.": "无法打开此图片，请选择其他 JPG、PNG 或 WebP 图片。",
  "This image is too large. Crop or resize it first.": "此图片过大，请先裁剪或缩小尺寸。",
  "Image processing is unavailable. Try a smaller image.": "暂时无法处理图片，请尝试使用更小的图片。",
  "This image is too detailed to attach. Crop it into a smaller image.": "此图片内容过多，无法添加，请裁剪后重试。",
  "Unable to add this image.": "无法添加此图片。",
  "This chat has too many images. Remove an image or start a new chat.": "此对话的图片数量或大小已达上限，请移除图片或开始新对话。",
  "The images are too large. Remove an image or start a new chat.": "图片过大，请移除图片或开始新对话。",
  "The image is invalid or too large. Choose a smaller JPG, PNG or WebP image.": "图片无效或过大，请选择较小的 JPG、PNG 或 WebP 图片。",
  "Add a prompt or an image.": "请输入提示词或添加图片。",
  "Only user messages can include images.": "只有用户消息可以包含图片。",
  "English": "English", "Chinese": "中文", "Language": "语言", "Change language": "切换语言",
  "Primary navigation": "主导航", "Open navigation": "打开导航", "Close navigation": "关闭导航",
  "Filazoo home": "Filazoo 首页", "Search workspace": "搜索工作区", "Search pages…": "搜索页面…",
  "No page found.": "未找到页面。", "Toggle color theme": "切换颜色主题",
  "System operational": "系统运行正常", "Operational": "运行正常", "Manage your workspace": "管理您的工作区",

  "Workspace": "工作区", "Overview": "概览", "Companies": "企业", "Pipeline": "销售管道",
  "Outreach": "客户触达", "Emails": "邮件", "Replies": "回复", "Messenger": "消息中心",
  "Deliverability": "送达能力", "Lead Channel": "获客渠道", "AI Agent": "AI 智能体", "AI Automation": "AI 自动化",
  "Catalogs": "目录", "Catalog management": "目录管理", "Products": "产品",
  "Company Catalogs": "企业专属目录", "Settings": "设置", "General": "通用",
  "Configuration": "配置", "Engagement": "客户互动", "Automation": "自动化",
  "Performance at a glance": "关键业绩一览", "Accounts and prospects": "客户与潜在客户",
  "Deals by stage": "按阶段查看商机", "Campaign activity": "营销活动表现",
  "Inbound conversations": "客户来信会话", "Facebook ad leads and Page Messenger replies": "Facebook 广告线索与主页消息回复",
  "Inbox health and checks": "收件箱健康度与检测", "Email follow-up flows and agent rules": "邮件跟进流程与智能体规则",
  "Products, pricing and availability": "产品、价格与供货情况", "Tailored selections for each company": "为每家企业定制选品",
  "Profile, security and team": "个人资料、安全与团队",

  "Analytics": "数据分析", "Total companies": "企业总数", "Active today": "今日活跃",
  "Open opportunities": "进行中的商机", "Pipeline value": "管道金额", "Attributed revenue": "归因收入",
  "Response rate": "回复率", "Companies added by source": "按来源统计新增企业", "Pipeline by stage": "按阶段统计销售管道",
  "Top catalog products": "热门目录产品", "Attribution channels": "归因渠道", "All attributed channels": "全部归因渠道",
  "Customize": "自定义", "Customize overview": "自定义概览", "Choose which widgets appear in your overview.": "选择概览中显示的组件。",
  "Comparison": "对比", "Comparison is turned off": "对比已关闭", "Comparison period": "对比周期",
  "Current period": "本期", "Previous period": "上期", "Apply": "应用", "Reset": "重置",
  "Any time": "任意时间", "Today": "今天", "Yesterday": "昨天", "Last 7 days": "最近 7 天",
  "Last 30 days": "最近 30 天", "This month": "本月", "All countries": "所有国家/地区",
  "All channels": "所有渠道", "All currencies": "所有币种",

  "A clear view of every account, source, market, and next sales opportunity.": "集中查看每个客户、来源、市场及下一步销售机会。",
  "Add company": "添加企业", "Add a company": "添加企业", "Export": "导出", "Export CSV": "导出 CSV",
  "Company": "企业", "Company name": "企业名称", "Company / customer": "企业 / 客户",
  "Company / customer name": "企业 / 客户名称", "Contact": "联系人", "Contact name": "联系人姓名",
  "Country": "国家/地区", "City": "城市", "Market": "市场", "Segment": "细分市场", "Website": "网站",
  "Source": "来源", "Owner": "负责人", "Stage": "阶段", "Status": "状态", "Actions": "操作", "Action": "操作",
  "Activity history": "活动记录", "Company information": "企业信息", "Account context": "客户背景",
  "Estimated order": "预计订单", "Est. order": "预计订单", "Not set": "未设置",
  "Unknown company": "未知企业", "Unknown contact": "未知联系人", "Unassigned": "未分配",
  "Active": "活跃", "Inactive": "未激活", "Prospect": "潜在客户", "Qualified": "已认证",
  "Customer": "客户", "Lead": "线索", "New": "新建", "Contacted": "已联系", "Replied": "已回复",
  "Sample": "样品阶段", "Negotiation": "商务谈判", "Won": "已成交", "Lost": "已流失", "Closed": "已关闭",
  "Back to companies": "返回企业列表", "Add opportunity": "添加商机", "Add an opportunity": "添加商机",
  "Opportunity": "商机", "Opportunity name": "商机名称", "Expected value": "预计金额",
  "Expected close": "预计成交日期", "Assign owner": "分配负责人", "No activity has been recorded yet.": "暂无活动记录。",
  "Your Supabase companies table is connected and empty. Add or import the first company to begin.": "Supabase 企业表已连接但暂无数据。请添加或导入第一家企业。",
  "Try changing your search or filters to see more results.": "请调整搜索条件或筛选器后重试。",
  "Viewer access is read-only": "查看者仅有只读权限", "Viewer access is read-only.": "查看者仅有只读权限。",

  "Sales pipeline": "销售管道", "Track opportunities from first contact through close.": "跟踪商机从首次接触到最终成交的全过程。",
  "All stages": "所有阶段", "All statuses": "所有状态", "Add a company first": "请先添加企业",
  "Open": "进行中", "In progress": "进行中", "Complete": "已完成", "Completed": "已完成",
  "Cancelled": "已取消", "Move to": "移动至",

  "Triage inbound conversations and surface buying signals quickly.": "快速分流客户来信并识别采购信号。",
  "Your reply inbox is clear": "回复收件箱已清空", "Customer replies will appear here with their related company and contact.": "客户回复将显示在这里，并关联对应企业与联系人。",
  "Inbox": "收件箱", "All mail": "全部邮件", "Unread": "未读", "Starred": "已加星标", "Sent": "已发送",
  "Drafts": "草稿", "Archive": "归档", "Compose": "写邮件", "New message": "新邮件", "To": "收件人",
  "Subject": "主题", "Body": "正文", "Send": "发送", "Send email": "发送邮件", "Sending…": "正在发送…",
  "Attach file": "添加附件", "Attach files": "添加附件", "Attach product catalog": "附加产品目录",
  "Add catalog PDF": "添加目录 PDF", "AI writing": "AI 写作", "AI suggestions": "AI 建议",
  "Start an AI-written reply": "使用 AI 起草回复", "Translate": "翻译", "Translating": "正在翻译",
  "Auto-translate": "自动翻译", "Original": "原文", "Suggestions": "建议", "Summary": "摘要",
  "Category": "分类", "Categories": "分类", "Priority": "优先级", "High": "高", "Medium": "中",
  "Low": "低", "Normal": "普通", "Follow up": "跟进", "Follow-up": "跟进", "Follow-up date": "跟进日期",
  "Mark as unread": "标为未读", "Mark as read": "标为已读", "Star email": "为邮件加星标",
  "No emails found": "未找到邮件", "Sync now": "立即同步", "Syncing…": "正在同步…",
  "Add a default mailbox in Settings before sending from the CRM.": "请先在“设置”中添加默认邮箱，然后再从 CRM 发送邮件。",
  "Unable to send the email.": "无法发送邮件。", "Unable to sync the mailbox inbox.": "无法同步邮箱收件箱。",
  "Unable to translate this email.": "无法翻译此邮件。", "Unable to write this email.": "无法生成此邮件。",
  "The CRM could not send this email.": "CRM 无法发送此邮件。", "Mailbox": "邮箱", "Choose a mailbox": "选择邮箱",
  "Attachments": "附件", "You can attach up to 10 files to one email.": "每封邮件最多可添加 10 个附件。",

  "Unified Messenger Inbox": "统一消息收件箱", "Bring messages into Filazoo and assign them to your CRM operators.": "将消息汇集到 Filazoo，并分配给 CRM 运营人员。",
  "All conversations": "全部会话", "Show unread only": "仅显示未读", "Show all conversations": "显示全部会话",
  "Write your message": "输入消息", "Assign to": "分配给", "Assign to me": "分配给我",
  "Show customer details": "显示客户详情", "View CRM profile": "查看 CRM 档案",
  "Waiting on customer": "等待客户回复", "Buying signal detected": "检测到采购信号",
  "The reply window is closed": "回复时限已结束", "Choose a conversation or connect this channel to get started.": "请选择一个会话或连接此渠道以开始使用。",

  "Deliverability overview": "送达能力概览", "Monitor domain health, authentication, and sending readiness.": "监控域名健康度、身份验证与发信准备情况。",
  "Domain health": "域名健康度", "Sending readiness": "发信准备情况", "Suppression list": "抑制名单",
  "Unsubscribe link present": "已包含退订链接", "SPF or DKIM records are missing from the outbound domain.": "发信域名缺少 SPF 或 DKIM 记录。",
  "Three contacts are currently on the suppression list.": "当前有 3 位联系人在抑制名单中。",
  "All safe checks passed": "所有安全检查均已通过", "Warnings": "警告",
  "Checks configuration, safety, and customer experience.": "检查配置、安全性与客户体验。",

  "Build, monitor, and improve automated customer journeys.": "构建、监控并优化自动化客户旅程。",
  "Automate timely follow-ups, internal tasks, and customer journey decisions.": "自动执行及时跟进、内部任务和客户旅程决策。",
  "Flows": "流程", "All flows": "全部流程", "New flow": "新建流程", "Create flow": "创建流程",
  "Flow name": "流程名称", "Trigger": "触发器", "Trigger event": "触发事件", "Steps": "步骤",
  "Add step": "添加步骤", "Save flow": "保存流程", "Turn on flow": "启用流程", "Stop flow": "停止流程",
  "Active runs": "运行中的流程", "All-time journeys": "全部历史旅程", "Audit flow": "审核流程",
  "Duplicate": "复制", "Delete flow": "删除流程", "This also removes its run history.": "这也会删除其运行历史。",
  "This cannot be undone.": "此操作无法撤销。", "Wait": "等待", "Wait 2 days": "等待 2 天",
  "Send email step": "发送邮件步骤", "Create task": "创建任务", "Update conversation state": "更新会话状态",
  "Branch on engagement": "按互动情况分支", "Stop if customer replies": "客户回复后停止",
  "Business days only": "仅工作日", "Skip weekends when evaluating the trigger.": "评估触发条件时跳过周末。",
  "All selected filters must match before enrollment.": "加入流程前必须满足所有已选筛选条件。",
  "Unable to save flow.": "无法保存流程。", "Unable to update flow.": "无法更新流程。",
  "Unable to duplicate flow.": "无法复制流程。", "Unable to delete flow.": "无法删除流程。",
  "All changes saved.": "所有更改均已保存。",
  "Preview": "预览", "Turn on": "启用", "Turn off": "停用", "draft": "草稿",
  "Drag to canvas or click to add": "拖到画布上，或点击添加", "Find an action": "查找操作",
  "Message": "消息", "Data": "数据", "Logic": "逻辑",
  "Send a tracked template": "发送可追踪模板", "Create CRM task": "创建 CRM 任务", "Assign follow-up work": "分配跟进工作",
  "Change category": "更改分类", "Internal alert": "内部提醒", "Notify a teammate": "通知团队成员",
  "Delay the next action": "延迟下一项操作", "If condition": "条件判断", "Stop": "停止", "End the journey": "结束客户旅程",
  "Audit this flow": "审核此流程", "Enrollment": "加入流程", "No reply after 2 days": "2 天后仍未回复",
  "Profile filters": "客户资料筛选", "One active run per conversation": "每个会话仅允许一个运行中的流程",
  "Move up": "上移", "Move down": "下移", "Step 1": "步骤 1", "Step 2": "步骤 2", "Step 3": "步骤 3",
  "Wait 2 days · business time": "等待 2 个工作日", "Helpful reminder": "友好提醒", "Opens": "打开次数", "Clicks": "点击次数",
  "Follow up with customer": "跟进客户", "End of flow": "流程结束", "Zoom out": "缩小", "Zoom in": "放大",
  "Fit flow to canvas": "适应画布", "Drag or scroll to pan · Ctrl-scroll to zoom": "拖动或滚动以平移 · Ctrl + 滚动以缩放",
  "Configure": "配置", "Insights": "洞察", "Journey trigger": "客户旅程触发器",
  "Choose the real CRM event that enrolls a contact.": "选择让联系人加入流程的实际 CRM 事件。",
  "Flow canvas. Drag the background or use the mouse wheel to pan. Drag cards to reposition them.": "流程画布。拖动背景或使用鼠标滚轮平移，拖动卡片可调整位置。",
  "Step": "步骤", "Enrollment:": "加入流程：", "No reply after": "未回复时长",
  "Duration": "时长", "Unit": "单位", "Days": "天", "Count business days only": "仅计算工作日",
  "Company filters": "企业筛选条件", "Any segment": "任意细分市场", "Any country": "任意国家/地区",
  "Company status": "企业状态", "Any status": "任意状态", "Pipeline stage filter": "销售管道阶段筛选",
  "Any stage": "任意阶段", "Minimum fit score": "最低匹配评分",
  "Each conversation can have only one active run in this flow.": "每个会话在此流程中只能有一个运行中的实例。",

  "Manage the complete B2B range, volume pricing, color variants, availability, and customer-ready exports.": "管理完整的 B2B 产品线、阶梯价格、颜色变体、供货状态及客户版导出文件。",
  "Total products": "产品总数", "Active products": "在售产品", "Ready to quote": "可立即报价",
  "No products synced": "尚未同步产品", "Add your first product or connect a source to populate pricing, colors, and availability.": "请添加首个产品或连接数据源，以同步价格、颜色与供货状态。",
  "Add product": "添加产品", "Add a product": "添加产品", "Product": "产品", "Product name": "产品名称",
  "SKU": "SKU", "Price": "价格", "Unit price": "单价", "Currency": "币种", "Availability": "供货情况",
  "Stock": "库存", "Stock status": "库存状态", "In stock": "有库存", "Out of stock": "缺货",
  "Quote available": "可报价", "MOQ": "最小起订量", "Material": "材料", "Materials": "材料",
  "Color": "颜色", "Colors": "颜色", "Variants": "变体", "Specifications": "规格", "Volume pricing": "阶梯价格",
  "Add variant": "添加变体", "View product details and variants.": "查看产品详情与变体。",
  "Captured from your store": "已从店铺同步", "Not synced": "未同步",
  "Create tailored product selections for each company and buying context.": "根据每家企业及采购场景创建定制选品目录。",
  "No company catalogs yet": "尚无企业专属目录", "Create catalog": "创建目录", "New catalog": "新建目录",
  "Catalog title": "目录标题", "Catalog PDF": "目录 PDF", "Complete Filazoo catalog": "完整 Filazoo 产品目录",
  "Download PDF": "下载 PDF", "Share the latest catalog": "分享最新目录",
  "The catalog PDF could not be generated.": "无法生成目录 PDF。", "This catalog does not contain any available products.": "此目录中没有可用产品。",

  "Account": "账户", "Security": "安全", "Team": "团队", "Profile": "个人资料",
  "This name appears throughout the Filazoo workspace.": "此名称将在整个 Filazoo 工作区中显示。",
  "Display name": "显示名称", "Email": "电子邮箱", "Save changes": "保存更改", "Saving…": "正在保存…",
  "My mailbox": "我的邮箱", "Personal mailbox": "个人邮箱", "Workspace mailbox": "工作区邮箱",
  "Common mailbox": "共享邮箱", "Shared workspace email": "工作区共享邮箱", "Configured mailboxes": "已配置邮箱",
  "Mailbox label": "邮箱名称", "Provider": "服务商", "Other": "其他", "Email address": "电子邮箱地址",
  "SMTP host": "SMTP 主机", "SMTP port": "SMTP 端口", "SMTP username": "SMTP 用户名",
  "SMTP password / app password": "SMTP 密码 / 应用专用密码", "IMAP host": "IMAP 主机", "IMAP port": "IMAP 端口",
  "IMAP username": "IMAP 用户名", "IMAP password / app password": "IMAP 密码 / 应用专用密码", "Notes": "备注",
  "Test and save my email": "测试并保存我的邮箱", "Test and save workspace email": "测试并保存工作区邮箱",
  "Testing connection…": "正在测试连接…", "Use this as the default workspace mailbox": "设为默认工作区邮箱",
  "No mailboxes configured yet.": "尚未配置邮箱。", "Password and sessions": "密码与会话",
  "Workspace role": "工作区角色", "Change password": "修改密码", "Invite a team member": "邀请团队成员",
  "Team member": "团队成员", "Member": "成员", "Role": "角色", "Admin": "管理员", "Operator": "运营人员",
  "Viewer": "查看者", "Invited": "已邀请", "Last sign-in": "上次登录", "Never": "从未",
  "Unnamed member": "未命名成员", "Invite": "邀请", "Update": "更新", "Remove": "移除",

  "Welcome back": "欢迎回来", "Sign in to manage your B2B outreach workspace.": "登录以管理您的 B2B 客户触达工作区。",
  "Password": "密码", "Forgot password?": "忘记密码？", "Sign in": "登录", "Signing in…": "正在登录…",
  "Sign out": "退出登录", "Back to sign in": "返回登录", "Back to login": "返回登录", "Reset password": "重置密码",
  "Update password": "更新密码", "Choose a new password": "设置新密码", "Show password": "显示密码",
  "Show passwords": "显示密码", "Private Filazoo workspace": "Filazoo 私有工作区",
  "We will send a secure recovery link to your workspace email.": "我们会向您的工作邮箱发送安全的密码恢复链接。",
  "Use at least 12 characters with uppercase, lowercase, a number, and a symbol.": "请使用至少 12 个字符，并包含大写字母、小写字母、数字和符号。",
  "This authentication link is invalid": "此身份验证链接无效", "Authentication error": "身份验证错误",
  "Request new link": "申请新链接", "Access denied": "访问被拒绝",
  "Your account is not a Filazoo workspace member": "您的账户尚未加入 Filazoo 工作区",
  "Something went wrong": "出现错误", "We could not load this view. Try again in a moment.": "无法加载此页面，请稍后重试。",
  "Try again": "重试",

  "Search": "搜索", "Filter": "筛选", "Filters": "筛选器", "Active filters": "已启用筛选", "Sort": "排序",
  "Clear": "清除", "Clear all": "全部清除", "All": "全部", "None": "无", "Select all": "全选",
  "Selected": "已选择", "Cancel": "取消", "Save": "保存", "Delete": "删除", "Edit": "编辑",
  "Add": "添加", "Create": "创建", "Close": "关闭", "Done": "完成", "Continue": "继续",
  "Next": "下一步", "Previous": "上一步", "Back": "返回", "View": "查看", "View all": "查看全部",
  "Download": "下载", "Upload": "上传", "Refresh": "刷新", "Loading…": "正在加载…", "Loading": "正在加载",
  "Updating…": "正在更新…", "No results": "没有结果", "Error": "错误", "Warning": "警告",
  "Success": "成功", "Required": "必填", "Optional": "选填", "Unknown": "未知", "Yes": "是", "No": "否",
  "Copied": "已复制", "Copy": "复制", "Page": "页", "of": "共",
  ...zhCNAdditional,
  ...zhCNSettings,
  "Analyse": "采购分析",
};

const translated = (input: string) => translateUiText(input, "zh-CN");
// Only match known UI sentence shapes; customer names, content and IDs stay intact.
const patterns: Array<[RegExp, (...parts: string[]) => string]> = [
  [/^Member deleted and workspace access removed\.(?: (\d+) customer assignments? redistributed to remaining BD Sales Managers\.)?(?: (\d+) customer assignments? remains? unassigned because no active BD Sales Manager has automatic assignment enabled\.)?$/, (reassigned, unassigned) => `${translated("Member deleted and workspace access removed.")}${reassigned ? ` 已将 ${reassigned} 项客户分配重新分配给其他商务拓展经理。` : ""}${unassigned ? ` 由于没有已启用自动分配的在职商务拓展经理，${unassigned} 项客户分配保留为未分配状态。` : ""}`],
    [/^(.+) · Filazoo$/, (page) => `${translated(page)} · Filazoo`],
    [/^Estimated value and deal count in (.+)$/, (currency) => `预计金额与商机数量，币种：${currency}`],
    [/^(\d+) leads$/, (count) => `${count} 条线索`],
  [/^(\d+) (products?|companies|customers|conversations?|invoices?|purchase orders|actions?|steps?|channels|variants?|contacts|items|records|emails?|messages?)$/, (count, noun) => `${count} ${({ products: "个产品", product: "个产品", companies: "家企业", customers: "位客户", conversations: "个会话", conversation: "个会话", invoices: "张发票", invoice: "张发票", "purchase orders": "份采购订单", actions: "项操作", action: "项操作", steps: "个步骤", step: "个步骤", channels: "个渠道", variants: "种规格", variant: "种规格", contacts: "位联系人", items: "项", records: "条记录", emails: "封邮件", email: "封邮件", messages: "封邮件", message: "封邮件" } as Record<string, string>)[noun]}`],
  [/^(\d+) (companies|products) exported\.$/, (count, noun) => `已导出 ${count} ${noun === "companies" ? "家企业" : "个产品"}。`],
  [/^Page (\d+) · (\d+) (.+)$/, (page, count, noun) => `第 ${page} 页 · ${translated(`${count} ${noun}`)}`],
  [/^(.+) pagination$/, (noun) => `${translated(noun)}分页`],
  [/^Step (\d+) of (\d+)$/, (step, total) => `步骤 ${step}，共 ${total} 步`],
  [/^(\d+) actions? · (\d+) active$/, (count, active) => `${count} 项操作 · ${active} 个运行中`],
  [/^No reply after (\d+) (hours?|days?)( · business time)?$/, (count, unit, business) => `${count} ${unit.startsWith("hour") ? "小时" : business ? "个工作日" : "天"}后仍未回复`],
  [/^Wait (\d+) (minutes?|hours?|days?)( · business time)?$/, (count, unit, business) => `等待 ${count} ${unit.startsWith("minute") ? "分钟" : unit.startsWith("hour") ? "小时" : business ? "个工作日" : "天"}`],
  [/^Category changed to (.+)$/, (category) => `分类更改为${translated(category)}`],
  [/^Company enters segment (.+)$/, (segment) => `企业进入细分：${segment}`],
  [/^Pipeline stage changed to (.+)$/, (stage) => `销售管道阶段更改为${translated(stage)}`],
  [/^(.+) · (\d+) actions?$/, (label, count) => `${translated(label)} · ${count} 项操作`],
  [/^Open account menu for (.+)$/, (name) => `打开 ${name} 的账户菜单`],
  [/^Options for (.+)$/, (label) => `${translated(label)}选项`],
  [/^Assign (.+)$/, (name) => `为 ${name} 分配负责人`],
  [/^Reply to (.+?)(…)?$/, (name, dots) => `回复 ${name}${dots ?? ""}`],
  [/^Quick reply to (.+)$/, (name) => `快速回复 ${name}`],
  [/^Email content from (.+)$/, (name) => `来自 ${name} 的邮件内容`],
  [/^Email copy: (.+)$/, (subject) => `邮件副本：${subject}`],
  [/^Select (.+)$/, (name) => `选择 ${name}`],
  [/^Open (.+)$/, (name) => `打开 ${name}`],
  [/^(Star|Unstar) (.+)$/, (action, subject) => `${action === "Star" ? "添加星标" : "取消星标"}：${subject}`],
  [/^Copy (.+)$/, (name) => `复制 ${name}`],
  [/^Remove (.+)$/, (name) => `移除 ${name}`],
  [/^Edit (.+)$/, (name) => `编辑 ${name}`],
  [/^(.+) copied\.$/, (name) => `已复制 ${name}。`],
  [/^(.+) saved\.$/, (name) => `${name}已保存。`],
  [/^(.+) saved for this demo session\.$/, (name) => `${name}已保存至本次演示会话。`],
  [/^(.+) is now assigned to you\.$/, (name) => `${name}现已分配给您。`],
  [/^Customer ID: (.+)$/, (id) => `客户 ID：${id}`],
  [/^Reply submitted through (.+)\.$/, (channel) => `回复已通过 ${channel} 提交。`],
  [/^Open until (.+)$/, (time) => `可回复至 ${time}`],
  [/^Live · (.+)$/, (channel) => `已连接 · ${channel}`],
    [/^Compared with (.+) in the comparison period$/, (amount) => `对比期间为 ${translated(amount)}`],
    [/^Lead added to (.+)$/, (list) => `线索加入${translated(list)}`],
    [/^Company enters (.+)$/, (segment) => `企业进入${translated(segment)}`],
    [/^Ask about (.+)…$/, (page) => `咨询${translated(page)}…`],
    [/^(.+): drag to resize, double-click to reset$/, (label) => `${translated(label)}：拖动调整大小，双击重置`],
  [/^compared with the preceding (\d+) days$/, (count) => `与前 ${count} 天对比`],
  [/^([\d.]+)% of opportunities$/, (percent) => `占商机的 ${percent}%`],
  [/^from ([\d.,%\p{Sc}\sA-Z]+)$/u, (value) => `上期为 ${value}`],
  [/^Ask about (.+), find patterns, or get a concise recommendation\.$/, (page) => `咨询${translated(page)}、发现规律，或获取简明建议。`],
  [/^Give me a task in (.+)\. I’ll prepare the action and wait for your approval\.$/, (page) => `告诉我${translated(page)}中的任务，我将准备操作方案供您审核。`],
  [/^([\d.]+)s$/, (seconds) => `${seconds} 秒`],
  [/^([\d.]+) kg$/, (weight) => `${weight} 千克`],
  [/^([\d.]+) mm$/, (diameter) => `${diameter} 毫米`],
  [/^(.+) \((\d+) products\)$/, (label, count) => `${translated(label)}（${count} 个产品）`],
  [/^\[([A-Z]\d*|P|C)\] (Customer profile|Connected contacts)$/, (id, label) => `[${id}] ${translated(label)}`],
];

export function translateUiText(value: string, language: AppLanguage): string {
  if (language === "en") return value;
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return value;
  const exact = Object.hasOwn(zhCN, text) ? zhCN[text] : undefined;
  if (exact) return `${leading}${exact}${trailing}`;
  const date = translateEnglishDate(text);
  if (date) return `${leading}${date}${trailing}`;
  for (const [pattern, format] of patterns) {
    const match = text.match(pattern);
    if (match) return `${leading}${format(...match.slice(1))}${trailing}`;
  }
  const page = text.match(/^Page (\d+) of (\d+)$/);
  if (page) return `${leading}第 ${page[1]} 页，共 ${page[2]} 页${trailing}`;
  const showing = text.match(/^Showing (\d+)–(\d+) of (\d+)$/);
  if (showing) return `${leading}显示第 ${showing[1]}–${showing[2]} 项，共 ${showing[3]} 项${trailing}`;
  const selected = text.match(/^(\d+) selected$/);
  if (selected) return `${leading}已选择 ${selected[1]} 项${trailing}`;
  const products = text.match(/^(\d+) products$/);
  if (products) return `${leading}${products[1]} 个产品${trailing}`;
  const companies = text.match(/^(\d+) companies$/);
  if (companies) return `${leading}${companies[1]} 家企业${trailing}`;
  const flowSummary = text.match(/^(\d+) actions · (\d+) active$/);
  if (flowSummary) return `${leading}${flowSummary[1]} 项操作 · ${flowSummary[2]} 个运行中${trailing}`;
  const actionCount = text.match(/^(\d+) actions$/);
  if (actionCount) return `${leading}${actionCount[1]} 项操作${trailing}`;
  const activeCount = text.match(/^(\d+) active$/);
  if (activeCount) return `${leading}${activeCount[1]} 个运行中${trailing}`;
  const stepLabel = text.match(/^Step (\d+)$/);
  const flowDropPosition = text.match(/^(Insert as|Move to) step (\d+)$/);
  if (flowDropPosition) return `${leading}${flowDropPosition[1] === "Insert as" ? "插入为" : "移动至"}步骤 ${flowDropPosition[2]}${trailing}`;
  const reorderedStep = text.match(/^(.+), step (\d+)\. Drag to reorder\.$/);
  if (reorderedStep) return `${leading}${zhCN[reorderedStep[1]] ?? reorderedStep[1]}，步骤 ${reorderedStep[2]}。拖动可调整顺序。${trailing}`;
  if (stepLabel) return `${leading}步骤 ${stepLabel[1]}${trailing}`;
  const addPosition = text.match(/^Add action at position (\d+)$/);
  if (addPosition) return `${leading}在位置 ${addPosition[1]} 添加操作${trailing}`;
  const draggableStep = text.match(/^(Wait|Send email|AI auto-reply|Create CRM task), step (\d+)\. Drag to reposition\.$/);
  if (draggableStep) return `${leading}${zhCN[draggableStep[1]] ?? draggableStep[1]}，步骤 ${draggableStep[2]}。拖动可调整位置。${trailing}`;
  return value;
}

const englishMonths = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function translateEnglishDate(text: string) {
  const time = (value: string) => value.replace(/(\d{1,2}:\d{2}(?::\d{2})?) (AM|PM)/, (_, clock: string, period: string) => `${period === "AM" ? "上午" : "下午"}${clock}`);
  const date = text.match(/^(?:(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),? )?(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})(?:, (\d{4}))?(?:(?:, | at )(\d{1,2}:\d{2}(?::\d{2})? (?:AM|PM)(?: [A-Z+\d:]+)?))?$/);
  if (date) {
    const month = englishMonths.indexOf(date[2].slice(0, 3).toLowerCase()) + 1;
    const weekday = date[1] ? ` ${({ Monday: "星期一", Tuesday: "星期二", Wednesday: "星期三", Thursday: "星期四", Friday: "星期五", Saturday: "星期六", Sunday: "星期日" } as Record<string, string>)[date[1]]}` : "";
    return `${date[4] ? `${date[4]}年` : ""}${month}月${date[3]}日${weekday}${date[5] ? ` ${time(date[5])}` : ""}`;
  }
  if (/^\d{1,2}:\d{2}(?::\d{2})? (AM|PM)$/.test(text)) return time(text);
}
