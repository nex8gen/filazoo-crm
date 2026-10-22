import test from "node:test";
import assert from "node:assert/strict";
import { buildMailerTransportConfig } from "../lib/mailer.ts";
import { normalizeMailboxRows } from "../lib/mailbox-utils.ts";
import { mailboxHasImap, mailboxHasSmtp } from "../lib/data/mailboxes.ts";

test("normalizes empty mailbox responses without crashing", () => {
  assert.deepEqual(normalizeMailboxRows(undefined), []);
  assert.deepEqual(normalizeMailboxRows(null), []);
  assert.deepEqual(normalizeMailboxRows([]), []);
  assert.deepEqual(normalizeMailboxRows([
    {
      id: "mailbox-1",
      user_id: null,
      type: "workspace",
      email: "hello@company.com",
      display_name: "Shared inbox",
      is_default: true,
      provider: "smtp",
      notes: "Primary workspace mailbox",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  ]), [
    {
      id: "mailbox-1",
      userId: null,
      type: "workspace",
      email: "hello@company.com",
      displayName: "Shared inbox",
      isDefault: true,
      isActive: true,
      provider: "smtp",
      notes: "Primary workspace mailbox",
      smtpHost: null,
      smtpPort: null,
      smtpUsername: null,
      smtpPassword: null,
      imapHost: null,
      imapPort: null,
      imapUsername: null,
      imapPassword: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ]);
});

test("builds a real SMTP transport config from mailbox settings", () => {
  const config = buildMailerTransportConfig({
    host: "smtp.gmail.com",
    port: 587,
    user: "hello@company.com",
    pass: "secret",
    from: "hello@company.com",
    secure: false,
  });

  assert.equal(config.host, "smtp.gmail.com");
  assert.equal(config.port, 587);
  assert.deepEqual(config.auth, { user: "hello@company.com", pass: "secret" });
  assert.equal(config.secure, false);
});

test("only reports a mailbox connection when the required credentials are complete", () => {
  const [mailbox] = normalizeMailboxRows([{
    email: "hello@company.com",
    smtp_host: "smtp.example.com",
    smtp_username: "hello@company.com",
    smtp_password: "smtp-secret",
    imap_host: "imap.example.com",
    imap_username: "hello@company.com",
    imap_password: "imap-secret",
  }]);
  assert.equal(mailboxHasSmtp(mailbox), true);
  assert.equal(mailboxHasImap(mailbox), true);
  assert.equal(mailboxHasSmtp({ ...mailbox, smtpPassword: null }), false);
  assert.equal(mailboxHasImap({ ...mailbox, imapPassword: null }), false);
  assert.equal(mailboxHasSmtp({ ...mailbox, isActive: false }), false);
  assert.equal(mailboxHasImap({ ...mailbox, isActive: false }), false);
});

test("stopped mailboxes retain credentials for resuming but cannot send or sync", () => {
  const [mailbox] = normalizeMailboxRows([{
    email: "hello@company.com", is_active: false,
    smtp_host: "smtp.example.com", smtp_username: "hello@company.com", smtp_password: "smtp-secret",
    imap_host: "imap.example.com", imap_username: "hello@company.com", imap_password: "imap-secret",
  }]);
  assert.equal(mailbox.isActive, false);
  assert.equal(mailbox.smtpPassword, "smtp-secret");
  assert.equal(mailbox.imapPassword, "imap-secret");
  assert.equal(mailboxHasSmtp(mailbox), false);
  assert.equal(mailboxHasImap(mailbox), false);
});
