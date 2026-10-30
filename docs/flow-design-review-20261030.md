# Flow editor design review — 30 October 2026

The design was revised in three iterations, checking the actual browser after each. All browser journeys used unsaved drafts; no flow was activated or email sent for this design review. These changes are local.

## Design diagnosis and changes

| Problem observed | Change | Evidence of improvement |
| --- | --- | --- |
| Three persistent controls and a boxed step label competed with each action summary. | Consistent action cards with one options menu, a small step number, a type icon and a full-width summary. | A 360px-wide category card now shows its summary on one line. The tested task card measured 94px tall. Edit, branch-aware move and remove remain available. |
| The normal and fallback path headings had different heights, offsetting their first actions. | Equal 104px path headers, lighter condition/fallback styling and a shared 48px column gap. | Both headers have the same top and height. Their first insertion slots align. The two-path footprint falls from 800px to 768px without narrowing action cards. |
| Fitting a large nested flow made individual actions difficult to read and locate. | Searchable flow outline, readable-zoom jumps and explicit branch ancestry above the settings form. | The qualification starter's deeply nested task opens at 360px width on the laptop. On a 390px phone it is 326px wide, with left/right bounds 32px/358px. Switching settings and canvas preserves that position. |
| A plain insertion list gave little guidance about actions or their destination. | Searchable picker with grouped icons, descriptions and a named destination path. | Searching `alert` returned the internal alert action; selecting it inserted only into Path 1. The canvas did not pan. |
| Six toolbar commands wrapped over several rows on a phone. | Audit, scenario tests and email tests share a Test flow menu; Preview, Save and Turn on remain visible. | At 390×844, the toolbar frees about 88px of vertical space. All three test commands remain reachable. Document scroll width equals its 390px viewport. |

## Reference patterns

[HubSpot's workflow navigation](https://knowledge.hubspot.com/workflows/use-the-new-workflow-navigation-bar) separates editing commands from navigation, and [its workflow editor guide](https://knowledge.hubspot.com/workflows/create-workflows) describes navigation to parts of larger workflows. [Klaviyo's flow guide](https://help.klaviyo.com/hc/en-us/articles/115002774932) uses an action sidebar and canvas; [its branching guide](https://help.klaviyo.com/hc/en-us/articles/115003883992) opens settings from a selected split. The outline is this application's implementation of direct navigation; it is not a copy of either product's minimap.

## Interaction verification

- Opened action options; confirmed first/last boundary restrictions and successfully moved a task within its branch.
- Dragged the redesigned task card from one path to another and confirmed original identity and destination order.
- Searched the insertion picker and inserted an alert into the named path.
- Searched the outline by both task title and branch name; selected the correct nested task and verified its settings ancestry.
- Tested the 11-action qualification starter on 1440×900 and 390×844 layouts. Temporary viewport overrides were reset.
- Opened Test flow → Test scenarios from the mobile toolbar: 72 scenarios still reached 11/11 actions and 6/6 paths.
- Caught and fixed menu pointer events being mistaken for card dragging. Also fixed hidden-panel measurements and repeated initial camera positioning during editor refreshes.

The browser evidence shows concrete improvements in information density, alignment, navigation and retained functionality. It is not a timed usability study with end users, so no claim is made about measured task completion speed or user preference.

## Screenshots

- [Action cards](audit-evidence/flow-design-cards-20261030.png)
- [Final inquiry-flow overview](audit-evidence/flow-design-desktop-final-20261030.png)
- [Searchable insertion picker](audit-evidence/flow-design-picker-20261030.png)
- [Nested flow at laptop size](audit-evidence/flow-design-nested-desktop-20261030.png)
- [Readable nested task and ancestry](audit-evidence/flow-design-focus-desktop-20261030.png)
- [Compact phone settings](audit-evidence/flow-design-mobile-editor-20261030.png)
- [Phone outline search](audit-evidence/flow-design-mobile-outline-20261030.png)
- [Phone card after switching settings and canvas](audit-evidence/flow-design-mobile-focused-card-20261030.png)

## Verification limits

All 48 targeted flow regression tests and targeted lint passed, including navigation ancestry, canvas layout, drag/drop, the action-combination matrix and flow validation. The broader repository test run recorded 947 passes and six failures: five task-inbox fixture failures in `tests/flow-activity.test.ts`, plus missing task-screen translations in the static i18n check. Full-repository lint also flagged CommonJS imports in `scripts/run-task-verification.cjs` and an unused type in another task script. These are separate ongoing task-workflow changes, not a clean whole-repository result.

Two existing task verification scripts needed explicit numeric price conversion to pass TypeScript; their runtime comparison semantics are unchanged. The final production build and all 10 current route bundle budgets passed. Results are recorded in `.vercel/flow-design-build.log` and `.vercel/flow-design-bundles.log`.
