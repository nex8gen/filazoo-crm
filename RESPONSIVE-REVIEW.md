# CRM structure and responsive review

Reviewed 22 October 2026. Changes are local to this repository.

**Current email status:** At the user's request, the email page's original layout has been restored. Its responsive redesign, alternate pane widths, reply disclosures, and follow-up overlay were reverted. Concurrent catalog PDF attachment work was preserved. Email redesign findings and checks below describe the earlier review and are superseded by this restoration.

## Structure

| Layer | Location | Responsibility |
| --- | --- | --- |
| Application composition | `app/layout.tsx` | Fonts, language, theme, tooltips, notifications, user menu, and the shared application shell |
| Navigation and viewport | `components/app-shell.tsx` | Navigation groups, search, public/auth routes, page gutters, and full-height workspaces |
| Route composition | `app/**/page.tsx` | Server-side authorization, data loading, and composition of the appropriate workspace |
| Workspaces | `components/` | Analytics, accounts, pipeline, email, Messenger, products, catalogs, and automation |
| Shared controls | `components/ui/` | Base UI primitives, forms, dialogs, sheets, tables, and pagination |
| Business and integration logic | `lib/`, `app/api/`, `app/crm-actions.ts` | CRM access, validation, actions, mailbox and lead integrations, and automation |
| Styling | `app/globals.css`, `app/responsive.css` | Existing tokens and table styles, plus shared adaptive layout rules |

The server/client split is appropriate: route components handle authorization and initial data; interactive workspaces maintain UI state. The main layout risks were in the shared shell and in specialized multi-pane workspaces, rather than the route directory structure.

## Research and design decisions

These references informed the implementation; the selected breakpoints are specific to this CRM's content.

| Reference | Application to Filazoo |
| --- | --- |
| [Material adaptive layouts](https://m3.material.io/foundations/layout/canonical-examples/overview) | Change pane structure with available space; keep mobile conversations and editors focused on one task. |
| [Salesforce compact layouts](https://help.salesforce.com/s/articleView?id=compact_layout_overview.htm&language=en_US&type=5) | Prioritize identifying fields and next actions in mobile company cards. |
| [Salesforce responsive grid](https://www.lightningdesignsystem.com/2e1ef8501/v/60694/p/61d07d-grid) | Use responsive stacking and content-driven grids. |
| [WCAG reflow](https://www.w3.org/WAI/WCAG21/Understanding/reflow) | Use 320 CSS pixels as the narrow-width check; keep unavoidable data-table scrolling local. |
| [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) | Provide larger phone controls and spacing. The implementation uses 44px minimums for common coarse-pointer controls; this is a design choice above the criterion's 24px size minimum, which has exceptions. |

## Findings and implementation

| Area | Finding | Change |
| --- | --- | --- |
| Navigation | A 304px desktop sidebar appeared at tablet widths; the mobile drawer reused the desktop rail. | Desktop sidebar begins at 1024px. Smaller screens get a scrollable sheet listing every destination, with dismissal and focus restoration. Desktop rail labels also expand on keyboard focus. |
| Page structure | Headers and actions could compete for width. Nested grids could grow to fit wide children. | Wrapping page actions, shrinkable grid children, explicit dashboard columns, and a skip-to-content link. |
| Companies | Dense records required desktop-style table scanning. | Mobile cards retain identity, status, country, email, owner, next action, selection, sorting, filtering, and paging. Summary metrics are compact on phones. Full details remain one tap away. |
| Products | A fixed wide table dominated the phone view. | Mobile product cards expose identity, variants, availability, pricing, selection, and the existing product editor. Desktop tables retain local scrolling and a visible pager. |
| Pipeline | Moving a deal relied on dragging. | A stage-focused phone list with stage and manager selectors uses the existing server actions. Desktop retains the Kanban board. |
| Messenger | The conversation pane was hidden on phones even after choosing a thread. | List-to-conversation navigation, a back control, on-demand customer details, and collapsible reply tools. The list heading is removed while reading on a phone. |
| Email | Dense header help and reply tools consumed reading space; follow-up controls were desktop-only. | A full-height workspace, mobile help disclosure, collapsible reply composer, optional reply tools, and an on-demand follow-up panel. Four inline panes appear only at 1800px and above. |
| Automation | Two minimum-height panes could exceed a short phone viewport; palette and inspector competed with the canvas. | Phone Canvas/Configure views, selection opening the inspector, shrinkable stacked tablet panes, a flexible name input, and a palette shown from 1600px. |
| Dialogs/popovers | Long forms could extend beyond short viewports. | Shared viewport-height limits and internal scrolling. Popovers are also constrained to available width. |
| Setup/public pages | Legacy setup classes had no useful adaptive layout; legal navigation could crowd its header. | Setup now uses responsive sections and cards; legal navigation wraps. |
| Touch/motion | Dense controls and small input text were unsuitable for phone interaction. | Coarse-pointer control sizing, 16px form text, safe-area padding in reply areas, and reduced-motion rules. |

## Browser validation

Signed-in Chrome viewport checks used live records without sending messages, creating records, changing owners, or changing pipeline stages.

| Views | Widths checked (CSS pixels) | Observed result |
| --- | --- | --- |
| Overview, Companies, Products, Emails, Replies, automation builder | 320, 390, 640, 768, 1024, 1280, 1536, 1920 | Document width stayed within the viewport after layout settled. Wide desktop tables scroll within their own regions. |
| Messenger conversation | Same eight widths | Verified with an isolated synthetic fixture because the connected Messenger inbox had no live conversations. The temporary route was removed afterward. |
| Pipeline, company details, Company Catalogs, Meta Leads, Settings, Setup | 320, 768, 1024, 1536 | No page-wide horizontal overflow observed. |
| Privacy, Data deletion, password recovery/update | 320 | No page-wide horizontal overflow observed. Invitation handling redirected the signed-in session to the overview. |

Interaction checks covered phone navigation dismissal, mobile email list/reader navigation, opening and closing follow-up details, showing/hiding the reply composer, opening product variants, Messenger list/conversation/back navigation, Messenger customer details, and the automation inspector switch. Short-height checks included 320×480.

### Desktop email grid correction

The initial overflow checks missed a wide-screen pane-placement regression: pixel-based arbitrary breakpoints mixed with Tailwind's rem-based breakpoints allowed the two-column grid rule to override the four-column rule while all four panes were visible. The result was two rows with the reader below the folders.

The custom email, Messenger, and automation breakpoints now use rem units consistently with the named Tailwind breakpoints. Email pane geometry was checked at 768, 1024, 1280, 1536, 1799, 1800, 1850, and 1920px. Every visible inline pane shared the same top position and height. At the reported 1850px width, columns measured 170 / 300 / 796 / 280px, all on one row. Geometry checks supplement page-width checks; absence of horizontal overflow alone does not establish correct layout.

## Automated checks

- ESLint passed after the component changes.
- The production Next.js build passed, including TypeScript and route generation.
- The latest complete test run passed 123 of 124 tests. `tests/product-editing.test.ts:15` expects the raw PDF text to contain contiguous `EXW unit price`; the concurrently updated PDF module splits that label across text operations. That independent implementation and its expectations were left intact.
- The temporary Messenger fixture route was removed before the final build.

## Verification limits

- Viewport testing in Chrome does not replace physical iOS/Android testing of virtual keyboards, browser chrome, or assistive technology.
- This is a responsive structure and layout review, not a complete WCAG conformance audit.
- Browser checks avoided persisted business changes. Pipeline and owner controls call the existing protected actions; actual record updates were not performed during layout verification.
- Messenger sending was not tested. The fixture used a closed reply window and no real destination.
- Existing integration settings and concurrent changes outside the responsive work were preserved.
