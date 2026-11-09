import { splitQuotedEmail } from "../email-content.ts";
import { matchQuotationProducts } from "./quotation-selection.ts";

export type EmailProductInquiry = {
  text: string;
  messageDirection?: "inbound" | "outbound";
  conversationHistory?: Array<{ direction: "inbound" | "outbound"; body: string }>;
};

/** Match the customer's own current text, never our offers or quoted old mail. */
export function matchSummaryProducts(inquiry: EmailProductInquiry, products: Array<{ sku: string; name: string; material: string }>) {
  const customerText = inquiry.messageDirection === "outbound"
    ? inquiry.conversationHistory?.findLast(message => message.direction === "inbound")?.body ?? ""
    : inquiry.text;
  return matchQuotationProducts(splitQuotedEmail(customerText).current, products);
}
