import Imap from "imap";
import { verifyMailboxSmtp } from "./mailer.ts";

export type MailboxConnectionInput = {
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPassword: string;
  imapHost: string;
  imapPort: number;
  imapUsername: string;
  imapPassword: string;
};

type MailboxProtocol = "SMTP" | "IMAP";

export function describeMailboxConnectionError(protocol: MailboxProtocol, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : "";
  const detail = `${code} ${message}`.toLowerCase();

  if (/greeting never received|timed?\s*out|etimedout|econnrefused|ehostunreach|enetunreach/.test(detail)) {
    const portHint = protocol === "SMTP"
      ? "For Gmail, try SMTP port 465; if both 587 and 465 fail, your network is blocking outbound mail ports and you must test from another network or the deployed app."
      : "For Gmail, IMAP must be reachable on port 993; test from another network or the deployed app.";
    return `${protocol} server did not respond. ${portHint}`;
  }

  if (/invalid credentials|authentication failed|auth(?:entication)? error|eauth|login failed/.test(detail)) {
    return `${protocol} authentication failed. Use your full email address and the provider's app password, not your normal account password.`;
  }

  if (/self[- ]signed certificate|unable to verify the first certificate|certificate/.test(detail)) {
    return `${protocol} TLS certificate verification failed. Confirm the server hostname is correct; the CRM will not disable certificate verification.`;
  }

  return `${protocol} connection failed: ${message}`;
}

function verifyMailboxImap(mailbox: MailboxConnectionInput) {
  return new Promise<void>((resolve, reject) => {
    const connection = new Imap({
      user: mailbox.imapUsername,
      password: mailbox.imapPassword,
      host: mailbox.imapHost,
      port: mailbox.imapPort,
      tls: true,
      tlsOptions: {
        rejectUnauthorized: true,
        servername: mailbox.imapHost,
        minVersion: "TLSv1.2",
      },
      authTimeout: 15_000,
      connTimeout: 15_000,
    });
    const finish = (error?: Error) => {
      connection.end();
      if (error) reject(error); else resolve();
    };
    connection.once("error", finish);
    connection.once("ready", () => finish());
    connection.connect();
  });
}

export async function verifyMailboxConnections(mailbox: MailboxConnectionInput) {
  try {
    await verifyMailboxSmtp({
      host: mailbox.smtpHost,
      port: mailbox.smtpPort,
      user: mailbox.smtpUsername,
      pass: mailbox.smtpPassword,
      from: mailbox.email,
      secure: [465, 994].includes(mailbox.smtpPort),
    });
  } catch (error) {
    throw new Error(describeMailboxConnectionError("SMTP", error));
  }

  try {
    await verifyMailboxImap(mailbox);
  } catch (error) {
    throw new Error(describeMailboxConnectionError("IMAP", error));
  }
}
