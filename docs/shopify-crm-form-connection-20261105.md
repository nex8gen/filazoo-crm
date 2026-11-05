# Shopify wholesale form connection — 5 November 2026

## Confirmed cause of the current connection break

The published theme is `Black Friday sale 2026- 04/11/26-v1` (`190048043087`). The published `/pages/b2b` page uses `templates/page.wholesale.json`, which includes `sections/filazoo-wholesale-form.liquid`.

Compared with the previous Halloween theme (`189133946959`), the Black Friday form lost:

- The hidden `crm_form_id` field.
- The `company_website_confirm` honeypot.
- The JavaScript that mirrors valid submissions into the CRM.

The public page still contains Shopify's normal `WholesaleApplication` contact form, but it has no CRM identifier or submission mirror. This establishes the current theme integration defect. It does not establish the causes of the two older database import failures, whose saved messages contain no underlying error details.

## Published repair

Created a duplicate of the Black Friday theme, repaired its form, and verified it in preview. The owner then published the repaired copy on 5 November 2026:

- Name: **Black Friday 2026 - CRM form repair - 05 Nov**
- Theme ID: `190106075215`
- Current role: **MAIN**, confirmed through the Shopify connector after owner publication.
- [Preview the repaired wholesale page](https://filazoo.com/pages/b2b?preview_theme_id=190106075215)
- [Open Shopify Themes](https://admin.shopify.com/store/3dproduct-2/themes)

Only `sections/filazoo-wholesale-form.liquid` was changed. It restores the previous CRM identifier and honeypot and adds a section JavaScript handler targeting `https://crm.filazoosupply.com/api/shopify/form-lead`. Shopify's native contact form action, customer fields, styling and confirmation remain intact. The previous mirror used the default Vercel hostname; the repair uses the public CRM custom domain.

Valid submissions receive a generated submission ID and use `sendBeacon`, with a `fetch`/`keepalive` fallback. Invalid forms and filled honeypots do not mirror. Theme-editor section reloads do not add duplicate listeners.

## Validation

- Shopify Liquid validator: passed all checks for the repaired section.
- Shopify Admin GraphQL operations: validated against the bundled 2026-10 schema.
- Six isolated JavaScript scenarios passed: normal beacon, rejected beacon fallback, absent beacon fallback, throwing beacon fallback, invalid form and honeypot. Rebinding does not duplicate listeners and the handler does not prevent Shopify's native submission.
- Read the saved draft section back through the connector: exact match with the validated source.
- Rendered the draft with Shopify's preview cookie: confirmed theme ID `190106075215`, unpublished role and restored CRM identifier.
- Fetched the actual compiled preview JavaScript: confirmed the public CRM endpoint is present.
- A production receiver probe used the filled honeypot and received HTTP 200, `Access-Control-Allow-Origin: https://filazoo.com`, and `{ "ok": true, "ignored": true }`. The handler returned before parsing a lead or performing database writes/workflow enrollment.
- No real lead was submitted, no historical import was replayed and no email was sent by these checks.

## Live verification

The connector permits theme-file writes only on unpublished themes and blocks theme publishing. The owner completed publication in Shopify Admin and confirmed it in the conversation.

After publication, fetched the public `/pages/b2b` page without a preview cookie and verified theme ID `190106075215`, role `main`, the native wholesale form and restored CRM identifier. Fetched the actual live compiled JavaScript and confirmed the custom-domain CRM endpoint is present. The form connection is now live. A full real-lead database insertion test has not been performed, so this review does not claim a real lead was received.

## CRM error-reporting follow-up

The two approved historical error-message reads both returned `Shopify lead could not be saved.` The importer discarded plain PostgREST error messages because it checked only `instanceof Error`. That diagnostic defect is fixed and published in Vercel deployment `dpl_DFiQA1w8nU7qMTWTYp4j7VCEAfRB`; the build and ten relevant tests passed. Both failed records remain unchanged.

## Future theme replacements

Keep the CRM hidden fields and the mirror handler when replacing the wholesale form section. Check the connection in the unpublished preview before publishing a new theme. An exported copy of the validated repaired section is stored in `docs/shopify/filazoo-wholesale-form.liquid`.

References: [Shopify contact forms](https://shopify.dev/docs/storefronts/themes/customer-engagement/add-contact-form), [theme performance guidance](https://shopify.dev/docs/storefronts/themes/best-practices/performance).
