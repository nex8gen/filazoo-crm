import "server-only";
import { readFileSync } from "node:fs";
import { AlipaySdk } from "alipay-sdk";
import { env } from "../env.ts";
import { amountFen, findPlan, yuan, type SubscriptionOrder } from "./plans.ts";

let sdk: AlipaySdk | undefined;
function key(name: string) {
  const value = process.env[name];
  if (value) return value.replace(/\\n/g, "\n");
  const path = process.env[`${name}_PATH`];
  return path ? readFileSync(path, "utf8") : "";
}
function alipayConfigured() {
  return /^\d{16}$/.test(process.env.ALIPAY_APP_ID || "")
    && /^2088\d{12}$/.test(process.env.ALIPAY_SELLER_ID || "")
    && Boolean(process.env.ALIPAY_PRIVATE_KEY || process.env.ALIPAY_PRIVATE_KEY_PATH)
    && Boolean(process.env.ALIPAY_PUBLIC_KEY || process.env.ALIPAY_PUBLIC_KEY_PATH);
}
export function alipayReady() {
  return process.env.ALIPAY_PAYMENTS_ENABLED === "true" && alipayConfigured();
}
export function getAlipay() {
  // Pausing new checkout must not suppress confirmation/refund notifications.
  if (!alipayConfigured()) throw new Error("Alipay payments are awaiting merchant activation.");
  if (!sdk) sdk = new AlipaySdk({
    appId: process.env.ALIPAY_APP_ID!, privateKey: key("ALIPAY_PRIVATE_KEY"),
    alipayPublicKey: key("ALIPAY_PUBLIC_KEY"), keyType: "PKCS8", signType: "RSA2",
    gateway: "https://openapi.alipay.com/gateway.do", camelcase: false, timeout: 8000,
  });
  return sdk;
}
export function checkoutUrl(order: SubscriptionOrder) {
  if (!alipayReady()) throw new Error("Alipay payments are awaiting merchant activation.");
  if (order.status !== "pending" || Date.parse(order.expires_at) <= Date.now()) throw new Error("Checkout has expired.");
  const origin = new URL(env.NEXT_PUBLIC_APP_URL).origin;
  if (process.env.NODE_ENV === "production" && !origin.startsWith("https://")) throw new Error("HTTPS is required for payments.");
  const plan = findPlan(order.plan_id);
  if (!plan || plan.amountFen !== order.amount_fen || order.currency !== "CNY") throw new Error("Invalid order.");
  // Mode 4 is Alipay's embeddable website cashier with an official payment QR.
  return getAlipay().pageExecute("alipay.trade.page.pay", "GET", {
    notifyUrl: `${origin}/api/alipay/notify`, returnUrl: `${origin}/subscribe/orders/${order.id}`,
    bizContent: {
      outTradeNo: order.out_trade_no, totalAmount: yuan(order.amount_fen),
      subject: `Filazoo ${plan.name} — 1 month`, productCode: "FAST_INSTANT_TRADE_PAY",
      sellerId: process.env.ALIPAY_SELLER_ID, qrPayMode: 4, qrcodeWidth: 230,
      timeExpire: new Date(Date.parse(order.expires_at) + 8 * 3600000).toISOString().slice(0, 19).replace("T", " "),
    },
  });
}
export function orderExpired(order: SubscriptionOrder) { return Date.parse(order.expires_at) <= Date.now(); }
export function parseNotification(body: string) {
  const params = new URLSearchParams(body);
  const data: Record<string, string> = Object.create(null);
  for (const [name, value] of params) {
    if (Object.hasOwn(data, name)) throw new Error("Duplicate notification field.");
    data[name] = value;
  }
  return data;
}
export function validateNotification(data: Record<string, string>) {
  if (data.sign_type !== "RSA2" || !getAlipay().checkNotifySignV2(data)) throw new Error("Invalid signature.");
  if (data.app_id !== process.env.ALIPAY_APP_ID || data.seller_id !== process.env.ALIPAY_SELLER_ID) throw new Error("Wrong payment recipient.");
  if (data.currency && data.currency !== "CNY") throw new Error("Wrong currency.");
  const amount = amountFen(data.total_amount);
  if (amount === null || !/^FZ[a-f\d]{32}$/i.test(data.out_trade_no || "") || !/^\d{16,64}$/.test(data.trade_no || "")) throw new Error("Invalid payment details.");
  return { outTradeNo: data.out_trade_no, tradeNo: data.trade_no, amount, status: data.trade_status };
}
export async function queryPayment(order: SubscriptionOrder) {
  const result = await getAlipay().exec("alipay.trade.query", { bizContent: { outTradeNo: order.out_trade_no } }, { validateSign: true });
  if (result.code !== "10000") {
    if (result.sub_code === "ACQ.TRADE_NOT_EXIST") return null;
    throw new Error("Alipay could not confirm this payment. Please retry.");
  }
  if (result.out_trade_no !== order.out_trade_no || amountFen(result.total_amount) !== order.amount_fen
    || (result.seller_id && result.seller_id !== process.env.ALIPAY_SELLER_ID)
    || (result.currency && result.currency !== "CNY") || !/^\d{16,64}$/.test(result.trade_no || "")) throw new Error("Payment response does not match the order.");
  return { outTradeNo: order.out_trade_no, tradeNo: String(result.trade_no), amount: order.amount_fen, status: String(result.trade_status) };
}
