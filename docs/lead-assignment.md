# Lead assignment controls

Administrators configure assignment under `/settings/advanced`. Controls include a workspace pause, lowest-workload or round-robin distribution, counting all companies or only open companies, manager participation, and optional per-manager company capacities. Open workload excludes pipeline stages `won` and `lost`.

Rules apply to incoming unowned Shopify and Meta companies. Existing company owners take priority. Manually created companies retain their creator as owner. An administrator can manually select any activated BD Manager even when that manager has paused automatic participation or reached their automatic capacity. Manual assignment continues to synchronize source leads, follow-up tasks, and company activity through the existing atomic assignment function.

Saving validates capacities and the current manager pool, checks administrator access again in the database, rejects stale settings revisions, and records an activity event. Save and discard are explicit; previews never consume a rotation turn. With assignment paused or no eligible manager below capacity, incoming unowned companies remain in the unassigned queue. Changing settings does not redistribute existing customers or drain that queue.

## Database rollout

Installed `supabase/migrations/20261106023215_lead_assignment_controls.sql` on the linked production database on November 6, 2026. It adds the settings table and read/save RPCs, updates the existing selection function, adds an atomic incoming-company assignment RPC for Shopify, separates manual eligibility from automatic participation, and removes the old sole-manager bulk-assignment triggers. Default settings retain lowest-workload distribution, all-company counting, current manager participation, and unlimited capacity. Installation does not update company owners.

The migration supports the current legacy schema and the pending workspace tenancy schema. The new table uses RLS and server-only grants; tenant installations receive a workspace key and isolation policy. When installed before the pending tenancy migration, that migration scopes this table along with the other CRM tables.

The settings page's load error was caused by this migration being absent. Before installation, a rollback-only rehearsal verified reading and saving settings under the production tenant role. Installation preserved the company, pipeline and member counts. The local migration filename matches the installed migration history version.

After installation, live REST reads passed for all three activated administrators across both workspaces using the application's workspace and actor headers. These checks made no data writes. The settings table has tenant RLS, and browser roles cannot read the table or execute the save function. Security advisors reported no new findings.

## Verification

Focused Node tests: `tests/lead-assignment-controls.test.ts` and `tests/lead-assignment-actions.test.ts`, alongside the existing CRM, assignment, Shopify, Meta, settings, member-removal, and localization tests.

Two optional local verification scripts use temporary packages without changing application dependencies:

```powershell
npm.cmd install --prefix tmp/lead-assignment-db --no-save --package-lock=false --ignore-scripts @electric-sql/pglite happy-dom esbuild
node scripts/verify-lead-assignment-database.mjs
node scripts/verify-lead-assignment-ui.mjs
```

The database script runs PostgreSQL in memory and verifies the migration against both legacy and tenant-isolated fixtures. It checks selection, pause, capacity, revision conflicts, manual overrides, permissions and cross-workspace isolation. The DOM script renders the real form and Base UI controls, exercising switches, both selectors, capacity input, preview, save/discard, error states, pending locks and navigation. Its persistence action is a local fixture; it does not claim to verify a deployed application. Neither script accesses hosted data.
