/** Shared by the homepage cards, quick-prompt menu and assistant response guidance. */
export const homePrompts = [
  {
    id: "campaign", placement: "card", label: "Plan a campaign", icon: "megaphone", tone: "peach",
    description: "Get an audience, email draft, and suggested timing.",
    prompt: "Help me plan an email campaign using our saved products and customer segments. Suggest a suitable audience, three subject lines, a short email draft, and timing. Ask one focused question if the campaign goal is missing. Keep this as a proposal for review; do not send or schedule anything.",
  },
  {
    id: "followups", placement: "card", label: "Prioritize follow-ups", icon: "calendar", tone: "lavender",
    description: "See which customers need your attention next.",
    prompt: "Review my accessible customer follow-up dates and assigned tasks. Identify overdue and upcoming follow-ups, explain why each needs attention, and suggest the next action with a link to the saved record. Use Asia/Shanghai for dates and state any limits in the records checked. Do not change anything.",
  },
  {
    id: "orders", placement: "card", label: "Review open orders", icon: "package", tone: "mint",
    description: "Check order status and spot the next steps.",
    prompt: "Review my accessible purchase orders and highlight open orders that need attention. Show the saved order reference, customer, status, value with currency, and next action where available. Separate drafts and cancelled orders from confirmed orders. State any limits in the records checked and do not change anything.",
  },
  {
    id: "invoices", placement: "card", label: "Find overdue invoices", icon: "receipt", tone: "sand",
    description: "Find unpaid balances that may need a reminder.",
    prompt: "Review my accessible invoices for overdue unpaid balances as of today in Asia/Shanghai. Show each invoice, customer, due date, days overdue, remaining balance with currency, and a suggested next step. Exclude draft, void, and fully paid invoices; distinguish missing due dates from overdue invoices. Do not send reminders or change anything.",
  },
  {
    id: "reply", placement: "chip", label: "Draft a customer reply", icon: "mail",
    description: "Write a reply using the customer's actual conversation.",
    prompt: "Help me draft a customer email reply using their latest accessible message and relevant conversation history. First ask which customer or conversation to use if none is selected. Use saved facts and product details, avoid unverified prices or delivery promises, and prepare the reply for review without sending it.",
  },
  {
    id: "quotations", placement: "chip", label: "Follow up on quotations", icon: "file",
    description: "Review quotations that may need a customer follow-up.",
    prompt: "Review my saved quotations and identify shared quotations that may need a follow-up. Show the customer, quotation date and status, value with currency where available, and a suggested next action. Separate drafts, accepted, expired, and declined quotations. Do not assume a customer has gone silent without checking their messages, and do not send or change anything.",
  },
  {
    id: "day", placement: "chip", label: "Plan my day", icon: "list",
    description: "Turn your due tasks into a practical daily plan.",
    prompt: "Review my assigned tasks and make a practical plan for today in Asia/Shanghai. Prioritize overdue and due-today work using saved priority and due dates, exclude completed or cancelled tasks, and link to each task. Separate tasks with no due date and explain any coverage limits. Suggest the order of work without creating or completing tasks.",
  },
  {
    id: "stock", placement: "chip", label: "Check product stock", icon: "boxes",
    description: "Check saved availability and inventory freshness.",
    prompt: "Review my accessible active products and saved inventory snapshots. Highlight low or unavailable stock only where supported by saved quantities or status, show the product SKU and variant where available, and report snapshot freshness. Distinguish saved product stock labels from verified inventory quantities. Do not start an inventory sync or promise availability, and state any coverage limits.",
  },
] as const;

export type HomePrompt = typeof homePrompts[number];
