# Workspace settings

Administrators can edit the workspace name, company website, logo, timezone, and business hours at `/settings/workspace`. Other active members can read the details and schedule. Ownership transfer and leaving a workspace retain their existing controls.

Logos accept PNG, JPEG, and WebP up to 2 MB. The server decodes the file, limits input dimensions, and stores a sanitized WebP up to 256 pixels on its longest edge. Logos appear on the workspace page and workspace switcher; they are never fetched from third-party image URLs.

The workspace timezone defaults to `Asia/Shanghai`. Home and Analytics use it for timestamp-based date boundaries. Date-only invoice, payment, and order dates retain their saved calendar dates. Hourly Home charts group events by local clock hour; a repeated daylight-saving hour shares a bucket, and a skipped hour has zero events. Billing and credit accounting retain their existing reset rules.

Business hours require at least one working day and a same-day opening/closing interval. Opening is inclusive; closing is exclusive. Workflows configured to send during business hours re-read the current workspace schedule when executing an email action. Workflow previews, scenarios, and scheduled delivery-test planning use the same scheduling function. Messages configured for anytime delivery retain that setting. Time-delay step rules remain independent of message business hours.

The activity log at `/settings/workspace/activity` is administrator-only, paginated, and isolated by workspace at both the server and database layers. Database triggers record changes to details/ownership, memberships, invitations, mailboxes, ERP configuration, AI access/usage settings, and lead-assignment settings. Entries record the actor when available, time, area, operation, target label, and changed field names. They do not store field values, credential values, tokens, policies, message content, or images. Logs begin when the migration is applied; earlier changes are not reconstructed.

Settings reads use request-local deduplication only. Saves invalidate retained application views. New workspace mutations are registered as guided handoffs in the agent capability audit.

Validation:

- `tests/workspace-settings.test.ts`: schedule and URL validation, timezone boundaries, daylight-saving gaps/repeated hours, report and workflow consistency.
- `tests/workspace-settings-actions.test.ts`: administrator authorization, current-workspace writes, safe image processing, failed saves, partial updates, invalidation.
- `tests/workspace-settings-database.sql`: rolled-back fixtures checking audit capture, no-op writes, database schedule validation, credential exclusion, tenant isolation, administrator visibility, and append-only permissions.
