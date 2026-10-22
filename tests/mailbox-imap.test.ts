import test from "node:test";
import assert from "node:assert/strict";
import { canReuseMailboxCheckpoint, mailboxMimeParts, mailboxTextParts } from "../lib/mailbox-imap.ts";

test("sync selects text alternatives while leaving large attachments on the server", () => {
  const structure = [{ type: "mixed" }, [
    { type: "alternative" },
    [{ partID: "1.1", type: "text", subtype: "plain", size: 300 }],
    [{ partID: "1.2", type: "text", subtype: "html", size: 600 }],
  ], [{ partID: "2", type: "application", subtype: "pdf", size: 20_000_000, disposition: { type: "attachment", params: { filename: "catalog.pdf" } } }]];
  assert.deepEqual(mailboxTextParts(structure).map((part) => part.partID), ["1.1", "1.2"]);
  assert.equal(mailboxMimeParts(structure).length, 3);
});

test("warm polling skips unchanged mail only while the IDLE checkpoint is fresh", () => {
  const cursor = { uidValidity: 1, lastUid: 25 };
  const state = { uidValidity: 1, verifiedUid: 25, version: 0, checkpointVersion: 0, verifiedAt: 1000 };
  assert.equal(canReuseMailboxCheckpoint(cursor, state, 10000), true);
  assert.equal(canReuseMailboxCheckpoint(cursor, { ...state, version: 1 }, 10000), false);
  assert.equal(canReuseMailboxCheckpoint(cursor, { ...state, verifiedUid: 50 }, 10000), false);
  assert.equal(canReuseMailboxCheckpoint(cursor, { ...state, uidValidity: 2 }, 10000), false);
  assert.equal(canReuseMailboxCheckpoint(cursor, state, 31000), false);
});

test("attached text files and forwarded messages do not replace the email body", () => {
  const structure = [{ type: "mixed" },
    [{ partID: "1", type: "text", subtype: "plain" }],
    [{ partID: "2", type: "text", subtype: "plain", disposition: { type: "attachment" } }],
    [{ partID: "3", type: "text", subtype: "html", params: { name: "document.html" } }],
    [{ partID: "4", type: "message", subtype: "rfc822", struct: [[{ partID: "4.1", type: "text", subtype: "plain" }]] }],
  ];
  assert.deepEqual(mailboxTextParts(structure).map((part) => part.partID), ["1"]);
});

test("single-part, HTML-only and empty messages have predictable body selection", () => {
  assert.deepEqual(mailboxTextParts([{ partID: "1", type: "text", subtype: "HTML" }]).map((part) => part.partID), ["1"]);
  assert.deepEqual(mailboxTextParts(null), []);
});
