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
    to: string;
    subject: string;
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
      from: config.from,
      to: mail.to,
      subject: mail.subject,
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

export async function verifyMailboxSmtp(mailbox: MailboxTransportInput) {
  const config = buildMailerTransportConfig(mailbox);
  if (!config) throw new Error("SMTP settings are incomplete.");
  const transport = nodemailer.createTransport({
    ...config,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}
