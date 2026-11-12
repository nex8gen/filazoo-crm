import nodemailer from "nodemailer";

export type MailboxTransportInput = {
  host?: string | null;
  port?: number | string | null;
  user?: string | null;
  pass?: string | null;
  from?: string | null;
  secure?: boolean | null;
};

export function buildMailerTransportConfig(input: MailboxTransportInput = {}) {
  const host = (input.host ?? "").trim();
  const user = (input.user ?? "").trim();
  const pass = input.pass ?? "";

  if (!host || !user || !pass) {
    return null;
  }

  const portValue = Number(input.port ?? (input.secure ? 465 : 587));
  const secure = input.secure ?? [465, 994].includes(portValue);

  return {
    host,
    port: Number.isFinite(portValue) ? portValue : secure ? 465 : 587,
    secure,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    auth: { user, pass },
    from: (input.from ?? user).trim() || user,
  };
}

export async function sendMailboxEmail(
  mailbox: MailboxTransportInput,
  mail: {
    to: string | string[];
    cc?: string | string[];
    bcc?: string | string[];
    subject: string;
    fromName?: string;
    replyTo?: string;
    messageId?: string;
    text?: string;
    html?: string;
    inReplyTo?: string;
    references?: string[];
    attachments?: Array<{
      filename: string;
      content: Buffer | string;
      contentType?: string;
      cid?: string;
    }>;
  },
) {
  const config = buildMailerTransportConfig(mailbox);
  if (!config) {
    throw new Error("Mailbox SMTP settings are incomplete.");
  }

  const transport = nodemailer.createTransport(config);
  try {
    return await transport.sendMail({
      from: mail.fromName ? { address: config.from, name: mail.fromName } : config.from,
      replyTo: mail.replyTo,
      to: mail.to,
      cc: mail.cc,
      bcc: mail.bcc,
      subject: mail.subject,
      messageId: mail.messageId,
      text: mail.text,
      html: mail.html,
      inReplyTo: mail.inReplyTo,
      references: mail.references,
      attachments: mail.attachments,
    });
  } finally {
    transport.close();
  }
}

export async function verifyMailboxSmtp(mailbox: MailboxTransportInput, options: { timeoutMs?: number } = {}) {
  const config = buildMailerTransportConfig(mailbox);
  if (!config) throw new Error("SMTP settings are incomplete.");
  const transport = nodemailer.createTransport({
    ...config,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      transport.verify(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { transport.close(); reject(new Error("SMTP check timed out. The sender connection has not been verified.")); }, options.timeoutMs ?? 20_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    transport.close();
  }
}

export async function buildMailboxMime(from: string, mail: Parameters<typeof sendMailboxEmail>[1]) {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
  try {
    const result = await transport.sendMail({ from: mail.fromName ? { address: from, name: mail.fromName } : from, ...mail });
    return result.message as Buffer;
  } finally { transport.close(); }
}
