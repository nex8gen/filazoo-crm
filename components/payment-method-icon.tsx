import { CreditCard, Landmark } from "lucide-react";
import { PAYPAL_ICON_PATH } from "@/lib/payment-icons";
import type { InvoicePaymentMethod } from "@/lib/invoice-payment-methods";

export function PaymentMethodIcon({ type, className = "size-4" }: { type: InvoicePaymentMethod["type"]; className?: string }) {
  if (type === "paypal") return <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" className={className} fill="#0070ba"><path d={PAYPAL_ICON_PATH} /></svg>;
  const Icon = type === "bank_transfer" ? Landmark : CreditCard;
  return <Icon aria-hidden="true" className={className} />;
}
