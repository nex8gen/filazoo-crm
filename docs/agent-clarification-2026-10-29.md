# Agent clarification and invoice dialogue — 29 October 2026

## Reported problem and reproduced behavior

The user asked `can create a invoice for this costmer` from a company's Purchase orders tab. The screenshot showed a generic invalid-plan response. A separate live reproduction on the same synthetic customer instead returned `Choose a specific variant for Basic PLA.` The user had not selected Basic PLA or any quantity. Both are failures to ask for missing business information.

Inspection of the saved conversation also showed two related risks: Black/Gold had produced a Red Gold proposal, and an address question produced a second invoice proposal. Existing user proposals were left untouched; verification used a separate conversation.

## Changes

- A bare first-turn invoice request asks for products, colors/variants and quantities using the verified open customer's name. Without a selected customer it asks for a company name or business email. It makes no model call to guess invoice lines. English and Chinese responses are supported.
- Added a validated, read-only question response. It is accepted as a successful planning result, creates no approval card and cannot be combined with read/action protocols. Answers remain in the saved conversation and continue the original task.
- Corrected the invalid-output recovery instructions. Recovery can ask a question or look up missing records; it no longer forces incomplete work into action JSON or incorrectly wraps original invoice actions as `crm_action` operations.
- A company lookup returning several candidates for a single-invoice creation request asks for a distinguishing customer choice before another model call or proposal. Explicit unique identities remain usable.
- A single invoice line's explicit English color pair or exact variant SKU is resolved against the actual loaded catalog. A model-selected Red Gold cannot replace requested Black Gold when a unique saved Black Gold variant exists. An unavailable or ambiguous match returns a question with actual saved options. No new product, quantity or price is invented. Multi-line free-text color interpretation remains model-assisted and must be reviewed.
- Missing/invalid invoice variant choices are returned as actionable questions rather than generic preparation errors. All proposals are still prepared before any are stored, so a clarification cannot leave partial auto-approved work behind.
- The next turn reloads up to five current, unexpired, owner-scoped invoice proposals from the same saved conversation. A compact planning view includes customer, billing/shipping addresses and up to 20 lines, with coverage. It excludes bank/payment secrets and source-thread metadata. Pending cards are explicitly unexecuted evidence.
- Invoice-detail questions such as `do you add address of the customer` cannot create duplicate invoices, even if the model repeats an earlier creation request. Recovery asks for a factual answer; a repeated mutation is blocked. Explicit change requests still use normal approval.
- Continuing the live dialogue exposed an existing shared prefill bug: a shipping-only customer billing profile overwrote the workspace currency with `undefined` and could reset payment terms. The shared invoice/customer prefill now preserves valid workspace defaults when profile fields are absent, validates explicitly configured values and carries saved delivery recipient/address/phone into the draft. Switching customers clears prior delivery details. No customer profile or workspace settings were rewritten.

## Validation

The release is based on the current published commit `d8d2dc420c0685417d42d40375a6977ee65b0cf6`. Unrelated, uncommitted purchase-order, email-account and schema changes are excluded. No migration or provider-credential change is needed.

The isolated release passed **765 tests**, ESLint, generated Next.js route types and TypeScript. The focused conversation, route, preparation and saved-history checks passed **81 tests**. Additional shared-prefill tests reproduce partial billing profiles, preserve default currency/terms, carry delivery details, clear prior-customer shipping and reject invalid stored commercial settings. They cover both approval modes, missing customer/items, ambiguous lookup results, clarification recovery, multi-turn continuation, exact catalog color/price resolution, unavailable variants, duplicate prevention and safe pending-proposal context.

## Live verification

The first clarification release, `dpl_4VFQ5Rpd2EXWXLvZSkYySr8gzcpG`, built successfully, passed staged/published database health checks and was promoted to `https://crm.filazoosupply.com`.

1. The exact reported request on the synthetic customer's Purchase orders tab named the current customer and asked for products, colors/variants and quantities, or a saved order reference. It created no approval card. Screenshot: `output/agent-clarification-question.jpg`.
2. Answering with the original Black/Gold, 100-piece request returned the actual available choices — Red Gold, Red Blue, Blue Green and Yellow Green — and asked which to use. It did not substitute Red Gold or prepare an invoice.
3. An explicit Red Gold choice exposed the partial-profile currency defect described above. This was traced to the shared customer prefill and reproduced in regression tests before the final build.

The first two requests displayed 31.1 and 23.3 seconds in the live UI. The bare-request path avoids a model call, but total browser-to-response latency includes saved-history, authorization and CRM reads; this release does not claim a universal latency improvement.

The final release, `dpl_8GRjyGNQUFRFJPausGe4GFyo2HKh` (`filazoo-46q4xbn2o-nex8gens-projects.vercel.app`), built successfully, passed its staged database health check and was promoted to the published CRM. The custom domain was verified to resolve to this deployment. Source hashes are recorded in `.vercel/agent-dialogue-release-manifest.json`.

4. Continuing the same saved conversation produced one correct approval card in 7.1 seconds: the synthetic customer, USD, 100 Silk PLA Two-tone Red Gold (`PLA-SILK-TWO-TONE-01`) at $5.66, total $566.00. Saved delivery recipient/address/phone and the synthetic-not-payable note appeared in the expanded details.
5. Before approval, `do you add address of the customer` answered in 5.5 seconds from the pending card: the saved delivery address and separate Boston billing location. There was still exactly **one** approval button/card; no replacement or duplicate invoice proposal was created. Screenshot: `output/agent-clarification-address.jpg`.
6. Approving that one card saved draft **INV-000040**, ID `07237c63-ab41-418b-9da7-5ec9ddbb3743`. The customer's independent Invoices tab showed exactly two invoices: the prior INV-000037 and this new draft. Opening the saved invoice independently confirmed Draft status, USD, 100 Red Gold pieces at $5.66, total $566.00, the saved delivery details, and `TEST ONLY synthetic clarification check, not payable.` No payment was recorded and no invoice was issued or emailed. Screenshot: `output/agent-clarification-saved-invoice.jpg`.
7. On `/companies` with no customer selected, the same bare request asked for the company name/business email and product/quantity details in 2.2 seconds. It did not choose a recent customer or create an approval card. Screenshot: `output/agent-clarification-missing-customer.jpg`.

These checks verify this conversation through a real saved action, rather than treating a generated answer or an approval preview as completion. They do not certify every possible interpretation. The saved draft remains labeled test-only; existing user proposals and unrelated customer records were not changed.
