import { parseNotification, validateNotification } from "@/lib/billing/alipay";
import { settlePayment } from "@/lib/billing/data";

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return new Response("failure", { status: 415 });
  // Bound the stream itself; Content-Length is not trustworthy.
  const reader = request.body?.getReader();
  if (!reader) return new Response("failure", { status: 400 });
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) { await reader.cancel(); return new Response("failure", { status: 413 }); }
      chunks.push(value);
    }
    const payment = validateNotification(parseNotification(Buffer.concat(chunks).toString("utf8")));
    await settlePayment(payment);
    return new Response("success", { headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" } });
  } catch {
    // Alipay retries non-success responses. Never acknowledge an uncommitted payment.
    return new Response("failure", { status: 400, headers: { "Cache-Control": "no-store" } });
  } finally { reader.releaseLock(); }
}
