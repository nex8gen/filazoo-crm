# AI Leads: buyer profiles and company research

Open **Companies → AI Leads** (`/lead-channel/ai-leads`).

## Research behind the redesign

| Reference | Documented workflow | Applied here |
| --- | --- | --- |
| [Apollo search filters](https://knowledge.apollo.io/hc/en-us/articles/4412665755661-Use-Search-Filters-to-Find-Prospects) | Explicit company/person filters and total/new/saved results | Filterable company table, CRM duplicate visibility and bulk selection |
| [Clay company discovery](https://university.clay.com/lessons/finding-companies) and [ICP suggestions](https://university.clay.com/docs/find-your-icp-based-on-your-domain) | Define a customer profile, preview companies, refine criteria, then enrich | Review product interpretation and buyer groups before researching companies and contacts |
| [Sales Navigator filters](https://www.linkedin.com/help/sales-navigator/answer/a1468001/) | Company attributes and locations are distinct from contact roles | Company qualification stays separate from contact availability |

These are workflow references, not access to those providers' databases. This feature uses public web research through the existing AI Gateway; it does not provide paid contact enrichment or email verification.

## User flow

1. **Products:** Select up to five related workspace products or describe a custom product. Catalog rows show names and SKUs, without imported quotation notes.
2. **Buyer profile:** Review the proposed product category, definition and distinct buyer groups. Select groups and a country, then optionally add a city/region, requirements and exclusions.
3. **Review:** Name the search and choose 3, 5 or 10 companies.
4. **Results:** New searches return only new, qualified companies with a public email, phone or contact page. Inspect source evidence in the drawer and save individually or in a selected batch. The search summary explains duplicates and candidates withheld for missing evidence, incompatible roles or unavailable contacts.

Product interpretation and suggested buyer groups are hypotheses for user review, not externally verified product claims.

## Qualification

Each company has independent checks for product relevance, physical target location, actual buyer role, extra requirements and official company identity.

**Qualified** requires all five checks met, including quoted official identity and actual buyer activity. Product evidence must support a compatible process/application. Location quotes must mention the target country and optional city; a quote about a different location cannot pass. Extra must-have requirements need source quotes too. Missing evidence produces **Needs review** internally; an explicit mismatch produces **Not a fit**. Neither is returned in new lead lists or eligible for CRM saves. Public contacts do not increase qualification. Numeric scores are not purchase probabilities.

Discovery researches a pool of 9–18 candidates (bounded by the requested size), then returns up to 3, 5 or 10 qualified prospects. A short or empty list is a valid outcome. The system does not lower its evidence threshold to fill the requested count. Qualification establishes supported fit, not confirmed purchase intent or deliverability.

A company selling supplies to service providers is not itself a service provider. A competing manufacturer is not a consumer of the same product it manufactures. Actual role evidence is compared against the selected target role.

Earlier searches stay visible with a notice. Update their targeting and rerun with a reviewed profile before saving additional companies.

## Architecture and access

- `lib/ai/lead-buyer-profile.ts`: Product interpretation and suggested groups.
- `lib/ai/lead-discovery.ts`: Separate discovery and qualification stages, source admission and bounded Gateway calls.
- `lib/public-business-page.ts`: DNS-pinned public reads, contact extraction and application-page selection.
- `lib/ai-leads.ts`, `lib/lead-prospecting.ts`: Runtime validation and deterministic qualification rules.
- `lib/lead-discovery-policy.ts`: Shared qualification gate, company identity matching and rotating search plans.
- `lib/data/ai-leads.ts`: Tenant-scoped profile cache, searches, feedback, execution and CRM saves.
- `/api/ai/leads/profile`: Authenticated, same-origin profile preparation.
- `/api/ai/leads`: History, search start/cancellation, feedback and saves.

Apply `20261109010747_ai_lead_discovery.sql`, `20261109014452_ai_lead_buyer_profiles.sql` and `20261109024005_ai_lead_quality_and_history.sql`.

Workspace discovery memory is backfilled from all earlier searches. Before paid research, the worker reads every page of CRM company identities and prior candidate identities; the UI's twenty-search history is not the exclusion limit. Exact normalized legal names, domains, website variants and parent/subdomain matches are checked locally. CRM contacts and other private record fields are not sent to discovery. A bounded list of public domains helps the model avoid known accounts, while local matching remains authoritative. Search plans rotate selected buyer activities and query angles by the previous attempt count without changing the requested location.

Candidates are remembered before website/qualification work, including candidates later rejected or unreadable. Failed/cancelled runs do not silently re-research that pool. The worker rechecks live CRM identities before committing to exclude accounts added during research. Memory is workspace isolated; deleting a search also deletes its linked candidate memory. Corporate identities on unrelated domains without matching names cannot be guaranteed to resolve to the same legal entity.

Profiles are cached by workspace, selected product data, business context and product clarification. A single claim prevents concurrent preparation. Product changes invalidate the cache. Profile IDs are checked against server-resolved products before searching; client audience data cannot replace the stored profile. Users can edit the reviewed category/definition and choose suggested groups.

Administrators, operators and BD managers can prepare profiles, search and save. Viewers can review. All tables have workspace RLS. Existing AI settings must allow web research and product access; existing spending limits apply.

## Sources, contacts and saving

Candidates require retrieved search sources. Official domains can be supported directly or by a cited directory, then must pass official-page identity checks. Connection-time DNS checks reject private/reserved destinations and cross-domain redirects.

At most three pages are read per company: homepage, a contact page, and a relevant product/material/application page. Excerpts prioritize identity, applications and addresses. Quotes must match downloaded pages. Short brand names require whole-word identity matches, and assessment domains are normalized before joining results.

Emails and phones come from downloaded HTML. Public emails remain unverified. Blocked sites, JavaScript-only contacts and unpublished details can remain unavailable. Buying intent stays unknown without explicit procurement evidence.

CRM saves atomically enforce qualification, check duplicates, create the company, save public contacts/phone/address and profile, record evidence, and link the result. Existing records are preserved. Names and roles are attached to an email only when evidence associates them. No outreach is sent.

## Cost and execution

- Search creation performs a read-only preflight using the same discovery request and live price quote as execution. Insufficient personal, workspace or monthly allowance returns HTTP 429 before inserting a job; paused allowance returns HTTP 403. The response carries only the caller's available amount, required reservation, limiting scope and reset time. It does not change any limit or make a paid provider request.
- The preflight checks the opening discovery reservation. Per-call atomic reservations still enforce the allowance during execution, including concurrent usage and qualification. A preflight is not a reserved guarantee for the complete search.
- Failed, allowance-blocked and cancelled searches have distinct UI states. They do not display a completed empty-results message, result filters, zero-company pagination or targeting advice for an allowance problem. Allowance information is separate from Vercel Gateway credit balance. Reset times are shown in Asia/Shanghai.
- Profile preparation: one call, at most **USD 0.02** reserved.
- Company research: two calls, one native search and at most **USD 0.18** reserved.
- One new profile plus one search is bounded by **USD 0.20** using existing credits. Cached profiles avoid another interpretation call. Explicit retries are separate attempts.
- No automatic paid retries, new subscriptions, credit purchases or budget increases.
- One active search per workspace. Request IDs and atomic claims prevent duplicate execution.
- Searches persist and run through Next.js `after`; leaving the page does not stop them. The route allows 180 seconds; research has a 150-second deadline.
- Cancellation prevents later stages/commits; an already-running provider request may use credits.
- Interrupted searches become failed after four minutes without progress, on the next read. Paid work is not replayed automatically.

## Verification

Run `node --experimental-strip-types --test tests/ai-lead-allowance.test.ts tests/ai-leads.test.ts tests/ai-leads-data.test.ts tests/ai-leads-route.test.ts tests/ai-budget.test.ts tests/ai-budget-server.test.ts` and `npx tsc --noEmit --pretty false`.

Execute `tests/ai-leads-database.sql` as one transaction. It rolls back fixtures and verifies workspace isolation including candidate memory, duplicate saves, qualification enforcement, and contact/phone/address persistence. Regression fixtures cover repeated searches, legal-name/URL variants, unqualified/contactless candidates, pagination beyond 500 identities, and companies added while research runs.

Optional live test: `node --env-file=.env.local --conditions=react-server --experimental-strip-types scripts/verify-ai-leads.ts --live --asa`. It uses existing credits, sends no messages and removes its disposable company/search records.

Live checks during the redesign confirmed product interpretation and public company/contact discovery. They exposed supplier-role and short-brand evidence bugs, which gained regression coverage. The final additional live run was stopped by the existing daily AI allowance. No allowance was raised or bypassed.
