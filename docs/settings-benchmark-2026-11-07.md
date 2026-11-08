# Settings benchmark and implementation review

Reviewed on 7 November 2026. This is a product compatibility review, code audit, and regression record. It is not a certification of enterprise readiness. Existing unrelated work in the checkout was retained.

## Reference products

Primary vendor documentation was researched, rather than copying screenshots or assuming that every competitor feature belongs in this CRM:

- [HubSpot profile and preferences](https://knowledge.hubspot.com/user-management/profile-and-preferences): personal presentation and defaults, with links to related email settings. The useful principle here is distinguishing a user's choices from company configuration.
- [Pipedrive settings](https://support.pipedrive.com/en/article/pipedrive-settings): separates company configuration, personal preferences, and interface choices. Its start-page preference is applicable to Filazoo's existing destinations.
- [Pipedrive personal email settings](https://support.pipedrive.com/en/article/personal-account-settings): connects mailbox setup with reading, composing, and privacy controls. Filazoo's personal/shared account model must remain explicit.
- [Zoho CRM account settings](https://help.zoho.com/portal/en/kb/crm/organization-settings/personal-settings/articles/manage-account-settings): distinguishes personal editing from administrator actions; includes regional preferences and appearance.
- [HubSpot notifications](https://knowledge.hubspot.com/user-management/how-to-set-up-user-notifications-in-hubspot): illustrates a separate event/channel preference model. Filazoo would need notification-delivery infrastructure before exposing equivalent switches.
- [Zoho audit logs](https://help.zoho.com/portal/en/kb/crm/security-control/audit-log/articles/monitor-audit-log): establishes a reference for searchable settings-change history. Existing CRM activity records are not equivalent to a complete administrative audit log.

The proposed organization below is our design judgment based on those references and Filazoo's existing behavior. It does not claim complete competitor feature parity.

## Final navigation

| Group | Pages | Ownership |
| --- | --- | --- |
| Personal | General; Appearance; Profile; Security and login; Email preferences | The current user; theme and language currently belong to the browser |
| Workspace | Workspace; AI access & behavior; Team and access; Lead assignment | Workspace/owner rules; Team and Lead assignment are administrator-only |
| Connections | Apps & connections; ERP connection | Own email versus shared team email; ERP is administrator-only |
| Billing | Invoices and payments | All members can inspect; admins/operators can edit |

There are 12 navigation destinations, reduced from 14. Personal mailbox management lives in Apps & connections → My email. Team email lives in its sibling tab. Payment methods live below invoice defaults with an in-page shortcut. ERP's app-library entry forwards to the existing ERP editor. The General page now contains personal preferences instead of repeated workspace and profile cards.

## One-by-one compatibility decisions

“Retained” means the existing capability is used, not newly invented. Test coverage is described separately below; a retained capability is not a claim of a fresh live-provider test.

| Setting / reference pattern | Existing Filazoo implementation | Decision and compatibility |
| --- | --- | --- |
| Profile name | Profile form and authenticated action | Retained in Profile. No second editor in General. |
| Profile image | Presets, upload, removal, signed avatar URLs | Retained; fresh preference metadata regression updated for the added start-page field. |
| Login email versus sending address | Auth account and mailbox records are separate | Retained distinction; changing a connection address requires a separate connection. |
| Language | English/Chinese browser preference | Retained in General with explicit browser scope. |
| Theme | Light/dark/system | Retained in Appearance; immediate browser behavior. |
| Accessibility | Table density and reduced motion | Retained in Appearance; accessible switches and OS motion support. |
| List size | Validated user preference, consumers in CRM lists | Retained in General; does not promise to affect every custom grid. |
| Default start page | Previously always the standard landing destination | Added: Overview, My day, Companies, Email. Login applies the validated choice when no explicit destination was supplied. |
| Deep links after login | Internal return-path handling | Retained; explicit record links take priority over the start page. External start-page values are rejected. |
| Password | Existing dedicated password flow | Retained in Security and login. |
| Other sessions | Existing authenticated revocation action | Retained; existing access tokens can remain valid until expiry. |
| Workspace name | Workspace administration | Retained only in Workspace; access rules preserved. |
| Workspace ownership and leaving | Existing owner transfer/leave controls | Retained, including the legacy-workspace upgrade state. |
| Membership invitations | Invite action and pending invitation list | Retained in Team and access. |
| Roles and member removal | Existing team table/actions | Retained; mailbox credentials removed from the people-management page. |
| Lead assignment enablement | Shared assignment policy | Retained in Lead assignment. |
| Distribution and capacity | Workload/round-robin rules and manager participation | Retained with existing preview and revision checks; contextual member eligibility remains relevant. |
| Personal email connections | Old manual page plus provider pages and hub | Consolidated in the hub. Gmail/Lingxi guided setup and custom SMTP/IMAP remain supported. |
| Shared email connections | Team page plus hub | Consolidated in the hub's Team email tab; administration remains restricted. |
| Existing connection editing | Old manual page selected a default mailbox | Added explicit account selection. Each hub account links to its own editor, including custom providers. |
| Default sender state | Old manual editor always checked the default switch | Fixed: edit uses saved default state; new accounts start unchecked. |
| Provider and notes | Old manual editor initialized generic values | Fixed: existing values passed explicitly; redundant provider selector removed from manual SMTP setup. |
| Mailbox credential persistence | Old generic save used email-key upsert | Fixed: new accounts insert; existing IDs must pass scope/ownership checks, and actual updates retain those filters. Duplicate addresses return an error. |
| Mailbox test failures | SMTP/IMAP verification before save | Retained; failed verification cannot report successful saving. |
| Paused mailboxes | Active-state control | Retained in the hub; credential edits omit active-state changes. |
| Disconnect | Existing delete action and confirmation | Available from the hub; preserves email history. No live disconnection performed. |
| Private account visibility | Own-personal versus shared-team overview | Retained in the hub; custom editor cannot select someone else's personal account. |
| Email translation | Personal initial reading preference | Retained in Email preferences; distinct from language and workspace AI policy. |
| Mark read | Personal reading preference | Retained, with manual read/unread actions still available. |
| AI reply suggestions | Personal initial suggestion preference | Retained; it does not grant AI permission or send mail. |
| Inbox refresh | Manual/15/30/60/120-second preference | Retained; background workflows remain independent. |
| Email footer | Existing rich footer editor and consumer | Retained in Email preferences; no duplicate signature editor added. |
| AI access and behavior | Existing policy, features, data areas, action approvals, writing guidance | Retained as the workspace policy; ordinary members inspect it without editing. |
| AI spending and per-member access | Form, schema, RPCs and enforcement existed, but form was not mounted | Restored under AI settings for administrators; loading failure is explicit and does not substitute fake limits. |
| App availability | Working and planned apps mixed through filters | Active library now includes implemented integrations only; removed the roadmap filter. Legacy planned detail URLs still explain availability. |
| ERP stock settings | ERP editor and app-specific duplicate entry | Canonical ERP editor retained; app entry redirects to it. Warehouse/SKU/sync controls preserved. |
| Seller identity | Invoice defaults | Retained in Invoices and payments, independent of workspace display name. |
| Currency, payment terms, tax | Existing invoice defaults and per-customer/per-invoice overrides | Retained; changing defaults does not rewrite issued invoices. |
| Payment instructions and notes | Existing default fields | Retained; broad default instructions and individual payment-method details have different consumers. |
| Bank/PayPal/other payment methods | Separate settings page | Combined into the billing page with an anchor; existing API and concurrency-preserving patch behavior retained. |
| Unsaved business settings | Explicit-save forms without common navigation protection | Added link-navigation and reload/close protection to invoice defaults, payment methods, AI policy, and AI usage forms. Browser back/forward and programmatic navigation require further router-level handling. |
| Settings discovery | Role-aware keyword registry | Retained and updated for mailbox, billing, start-page and spending terms, including Chinese keywords. |
| Small-screen navigation | Expandable settings rail | Retained; four meaningful groups replace the mixed workspace list. |

## Removed duplication and backward compatibility

| Existing entry | Canonical destination |
| --- | --- |
| `/settings/general` | `/settings` |
| `/settings/mailboxes` | `/settings/apps?view=personal` |
| `/settings/integrations` | `/settings/apps` |
| `/settings/payments` | `/settings/invoices#payment-methods` |
| `/settings/apps/lingxing` | `/settings/erp` for administrators |
| Shared mailbox forms on Team and access | `/settings/apps?view=team` |

Navigation highlighting understands legacy aliases and nested app pages. Existing links remain usable. Saved settings, customer records, credentials, roles, and issued invoices are not deleted by this reorganization.

## Enterprise gaps requiring additional product work

These are real gaps, not inactive settings to present as completed features:

| Priority | Capability | Reason it is not a switch-only addition |
| --- | --- | --- |
| High | MFA, recovery codes, active-device inventory; enterprise SSO if required | Needs enrollment, challenge, recovery, session assurance, and account-recovery verification. Current password/session controls are narrower. |
| High | Central administrative audit history | Needs durable actor/workspace attribution across settings writes, retention, authorized search, and tamper-resistant recording. |
| High | Atomic default-mailbox changes | Existing default reset and credential save use separate writes. Saved default state is now presented correctly, but a transactional operation is still needed for all-or-nothing switching under failures/concurrency. |
| High | Account/workspace data export, retention, deletion workflow | Needs ownership rules, export jobs, storage access, retention policy, and recovery/approval behavior. Existing policy pages are not self-service data management. |
| Medium | Notification event/channel preferences | Tasks/notifications exist, but configurable delivery needs a real per-event subscription and dispatch system. |
| Medium | Locale, date format, personal/workspace time zones | Existing formatting and workflow scheduling have different consumers. A preference must be applied throughout display and scheduling before claiming support. |
| Medium | Field schemas, duplicate rules, import/export and merge governance | Requires record validation/migration and permissions; cannot be modeled as isolated UI options. |
| Medium | OAuth mail reconnect and token management | Gmail/Lingxi app-password flows exist. Microsoft OAuth and calendar/drive integrations remain unavailable. |
| Conditional | Custom roles, SCIM, IP restrictions, service accounts/API-key lifecycle | Depends on customer and organization needs and requires new authorization/control infrastructure. |

## Verification record

- TypeScript checking (`npx tsc --noEmit`) and full-checkout ESLint passed.
- Production shell JavaScript budgets passed using `FILAZOO_STABLE_RUNTIME=1 npm run perf:bundles`.
- The full Node suite passed: **1,690 tests, 0 failures**. The final targeted settings/localization checks also passed.
- Production build passed using `FILAZOO_STABLE_RUNTIME=1 npm run build -- --webpack` (117 prerendered pages). The normal Turbopack production build stalled during compilation and was stopped; its production build has not been verified. The active development server continued to render the changed pages.
- Focused action tests exercise user preference persistence/failure, start-page validation and deep-link priority, role-aware settings search and aliases, invoice/payment authorization and patch preservation, provider mailbox isolation, and manual mailbox insert/update safety.
- Manual-mailbox regressions cover foreign IDs, forged scopes, changed addresses, duplicate email addresses, missing update targets, failed verification, credential preservation, and non-admin shared-mailbox denial.
- AI usage tests cover caps/toggles, exact USD conversion, blank versus zero limits, failed saves, and revision conflicts.
- Browser verification on the running local development server confirmed that changing the start page to My day saves and survives a full reload. The original Overview choice was restored afterward. The app library excludes planned integrations; Team email shows its existing account; Manage opens that specific connection with empty saved-password fields. AI usage loads real workspace and member limits. Combined billing renders both editors, and Team and access renders invitations/members without mailbox forms.
- No live invitations, email delivery, credential changes, session revocations, billing changes, or mailbox deletion were performed for this review. Provider checks in automated action tests use controlled fixtures.

Database-only ERP/AI SQL suites require their configured database environment and were not run here. Live non-admin browser sessions, mobile viewport behavior, browser history navigation with unsaved edits, provider credential saves, and destructive operations were not exercised. Their existing automated coverage or code review should not be interpreted as a live end-to-end test.
