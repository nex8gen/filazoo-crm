import type { CrmRead } from "./crm-tools.ts";
import { clipEvidence, selectConversationEvidence } from "./customer-intelligence.ts";

type Row = Record<string, unknown>;
type Page = { records: unknown[]; coverage?: { matching?: number | null; nextOffset?: number | null; [key: string]: unknown } };
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown) => Array.isArray(value) ? value.map(object) : [];

/** Screening is deliberately small; detailed reads remain available for every saved ID. */
export function customerScreeningRecord(value: unknown) {
  const row = object(value), email = object(row.email), notes = object(row.notes);
  const messages: (Row & { direction: string; timestamp: string })[] = rows(email.records).map(message => ({ ...message, direction: String(message.direction ?? ""), timestamp: String(message.timestamp ?? "") }));
  const selected = selectConversationEvidence(messages, 4);
  const selectedNotes = rows(notes.records).filter(note => note.type === "staff_comment").slice(0, 1);
  const compactSource = (value: unknown) => {
    const source = object(value);
    return { count: source.count, available: source.available, complete: source.complete };
  };
  return {
    id: row.id, href: row.href, name: row.name, country: row.country, segment: row.segment, status: row.status, assignedTo: row.assignedTo,
    email: {
      messages: email.messages, conversations: email.conversations, inbound: email.inbound, outbound: email.outbound,
      available: email.available, countsComplete: email.countsComplete, ambiguousAddresses: email.ambiguousAddresses,
      unloadedBodies: email.unloadedBodies, latestAt: email.latestAt, lastInboundAt: email.lastInboundAt, lastOutboundAt: email.lastOutboundAt, replyState: email.replyState, complete: false,
      omittedEvidence: typeof email.messages === "number" ? Math.max(0, email.messages - selected.length) : undefined,
      records: selected.map(message => {
        const body = object(message.body), excerpt = clipEvidence(body.text, message.direction === "inbound" ? 500 : 250);
        return { id: message.id, href: message.href, direction: message.direction, from: message.from, to: message.to, timestamp: message.timestamp,
          subject: clipEvidence(message.subject, 160), contentAvailable: message.contentAvailable,
          body: { text: excerpt.text, truncated: Boolean(body.truncated || excerpt.truncated) } };
      }),
    },
    notes: { ...compactSource(notes), omittedEvidence: Math.max(0, Number(notes.count ?? 0) - selectedNotes.length),
      records: selectedNotes.map(note => {
        const summary = object(note.summary), excerpt = clipEvidence(summary.text, 250);
        return { id: note.id, type: note.type, href: note.href, createdAt: note.createdAt, summary: { text: excerpt.text, truncated: Boolean(summary.truncated || excerpt.truncated) } };
      }) },
    orders: compactSource(row.orders), quotations: compactSource(row.quotations), invoices: compactSource(row.invoices),
    tasks: compactSource(row.tasks),
    purchasePipeline: row.purchasePipeline,
  };
}

/** Follow saved-record pagination without spending one model generation per population page. */
export async function collectCustomerComparison(read: (lookup: CrmRead) => Promise<Page>, options: { signal?: AbortSignal; maxCharacters?: number; maxPages?: number } = {}) {
  const records: ReturnType<typeof customerScreeningRecord>[] = [], pages: NonNullable<Page["coverage"]>[] = [];
  const seen = new Set<unknown>();
  let offset = 0, nextOffset: number | null = 0, matching: number | null = null, characters = 0;
  let incompleteReason: string | undefined;
  const maxCharacters = options.maxCharacters ?? 500_000, maxPages = options.maxPages ?? 100;
  while (nextOffset !== null && pages.length < maxPages) {
    if (options.signal?.aborted) { incompleteReason = "Population screening time limit reached"; break; }
    let page: Page;
    try { page = await read({ resource: "customer_insights", query: "", offset }); }
    catch { incompleteReason = "Some customer records could not be loaded"; break; }
    pages.push(page.coverage ?? {});
    if (typeof page.coverage?.matching === "number") {
      if (matching !== null && matching !== page.coverage.matching) incompleteReason = "Customer population changed during screening";
      matching = page.coverage.matching;
    }
    let included = 0;
    for (const value of page.records) {
      const record = customerScreeningRecord(value), size = JSON.stringify(record).length;
      if (!record.id || seen.has(record.id)) { incompleteReason = "Population pagination returned duplicate or missing customer IDs"; break; }
      if (characters + size > maxCharacters) { incompleteReason = "Population screening evidence limit reached"; break; }
      records.push(record); seen.add(record.id); characters += size; included++;
    }
    if (included < page.records.length) { nextOffset = offset + included; break; }
    const next = page.coverage?.nextOffset;
    if (next === null) { nextOffset = null; break; }
    if (typeof next !== "number" || !Number.isInteger(next) || next <= offset || next > 100_000 || !included) {
      incompleteReason = "Population continuation could not be verified"; nextOffset = offset + included; break;
    }
    nextOffset = next; offset = next;
  }
  if (nextOffset !== null && !incompleteReason) incompleteReason = "Population screening page limit reached";
  const populationComplete = !incompleteReason && nextOffset === null && matching !== null && records.length === matching;
  return { records, coverage: { matching, included: records.length, offset: 0, nextOffset, populationComplete,
    incompleteReason: incompleteReason ?? (!populationComplete ? "Population total could not be verified" : undefined),
    scope: "Accessible saved customers screened using bounded recent inbound/outbound email excerpts and supporting CRM counts. This is not a full conversation review. Read shortlisted customer IDs and their email history before ranking. Unlinked social conversations are not included.",
    deepReviewRequired: true, pages,
  } };
}
