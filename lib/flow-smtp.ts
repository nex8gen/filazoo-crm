/** Retry only failures establishing a connection, before the message can be submitted. */
export async function submitFlowEmail<T>(send: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await send(); }
    catch (cause) {
      const error = cause as { code?: string; command?: string; message?: string };
      const beforeSubmission = error?.command === "CONN" && ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ESOCKET"].includes(error.code || "");
      if (!beforeSubmission) throw cause;
      if (attempt >= 1) throw new Error(`SMTP connection failed before submission: ${error.message || error.code}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
