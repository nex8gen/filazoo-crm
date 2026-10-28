# Lingxing ERP stock

The CRM reads Lingxing warehouse inventory and matches exact, case-sensitive product/variant SKUs. It displays **available quantity** (`product_valid_num`) and stores on-hand and locked quantities separately. This integration covers local and overseas warehouses; Amazon FBA requires its separate inventory API.

## Connect without editing code

1. Enable OpenAPI in your Lingxing administrator account and grant the **warehouse inventory details** API permission (`/erp/sc/routing/data/local_inventory/inventoryDetails`).
2. Add the CRM server's **outbound IP address** to Lingxing's IP allowlist. The IP of your laptop/browser is not the deployed server's IP. A serverless deployment needs stable outbound IPs or a fixed-IP worker before it can pass this restriction.
3. Sign into the CRM as an administrator and open **Settings → ERP connection**. It is also linked from **Settings → Connected channels** and **Products → Manage ERP connection**.
4. Enter a connection name, App ID and App Secret. Secrets are encrypted in Supabase Vault and are never sent back to the browser. Leave the secret field blank to keep the saved secret; changing the App ID requires its new secret. Existing environment-based credentials can be imported by saving this form.
5. Use **Detect server IP** to see the outbound IP observed for this request. Confirm stable outbound IPs with your host, then add them in Lingxing. This detection cannot provision static networking or edit Lingxing's allowlist.
6. Use **Load warehouses** to choose local/overseas warehouses by name, or enter comma-separated warehouse IDs. Loading names requires Lingxing's warehouse-list API permission. Leave IDs blank to include all local/overseas warehouses.
7. Add **Product SKU mapping** rows wherever a CRM SKU differs from its ERP SKU. Identical SKUs match automatically. CRM product/variant SKUs are suggested while typing. Map each sellable color/size variant; map a parent product only if it is genuinely a single ERP stock item. Shared ERP aliases are counted once per product family.
8. Select **Manual only**, **Every 5 minutes**, **Every 15 minutes**, **Every hour**, or **Every day**. Automatic mode must be saved from the deployed HTTPS CRM, not localhost.
9. Choose **Test connection** to verify authentication, IP access and inventory permission without saving or modifying stock. Choose **Save connection**, then **Sync now**. Saving itself does not claim the API connection was tested.

Check the Products match count and individual variants; unmatched products stay unknown instead of being treated as zero stock. No product prices or ERP quantities are changed. Uncheck **Enable this connection** and save to pause both manual and automatic stock syncing. A paused saved connection overrides legacy environment credentials.

## Keep stock current

The database migration installs an idle five-minute Supabase Cron tick. When automatic mode is enabled, the tick checks the interval saved in Settings and requests the deployed CRM's `/api/cron/inventory` endpoint. The scheduler's bearer credential is generated and encrypted in Vault automatically. No Vercel plan upgrade, cron expression, environment-variable edit, or code change is needed when changing the connection or cadence. There are no HTTP requests until an administrator configures an enabled automatic connection. A 15-minute interval runs on the next eligible five-minute tick, so it is not an exact-time guarantee.

The deployed endpoint must be reachable by Supabase. Login/protection at the hosting platform can block the scheduler before the request reaches the app. Use the public production CRM address when saving automatic mode; ordinary staff login does not block this separately authenticated worker.

The endpoint returns `skipped: true` while another sync is running or a request occurred within 30 seconds. Calls require the bearer secret even though they bypass the staff login gate. A full sync has a four-minute fetch timeout and a five-minute database lease. A successful complete response atomically replaces the previous snapshot. Empty or omitted SKU rows become unknown, not inferred zero. Errors retain the previous snapshot; quantities older than 30 minutes are labelled stale. A failed worker's lease expires automatically so a later run can recover.

Stock is a read-only ERP snapshot, not an order reservation or a guarantee that inventory remains available after the last sync. A user can manually refresh it before preparing an order. Configuring a different ERP account or warehouse scope hides stock from the previous configuration.

## Installation and verification

Both migrations are already applied to the connected CRM database. A new installation needs `20261028010721_lingxing_inventory_sync.sql` and `20261028015349_erp_connection_settings.sql`. The second migration requires the Supabase Vault, pg_cron, and pg_net extensions and installs the scheduler. Legacy `LINGXING_APP_ID`, `LINGXING_APP_SECRET`, `LINGXING_WAREHOUSE_IDS`, and `LINGXING_SKU_MAP` variables remain supported only until a saved Settings connection exists. `CRON_SECRET` remains an optional legacy worker credential; the Settings scheduler manages its own credential.

Credentials only go to Lingxing's token endpoint as multipart form data. Business requests use an Authorization Bearer header and the documented ASCII-sort → uppercase MD5 → AES-ECB signature with App ID as the AES key. Requests are sequential to respect the inventory endpoint's token-bucket concurrency of one. Inventory tables and publication functions are accessible only to the server service role; staff actions validate workspace membership.

`tests/lingxing.test.ts`, `tests/erp-settings.test.ts`, and `tests/inventory-actions.test.ts` cover signing, authentication, pagination, duplicate/invalid rows, SKU mapping, zero/unknown stock, stale timestamps, permissions, secret preservation, schedule validation, and action results. `tests/inventory-database.sql` and `tests/erp-settings-database.sql` verify permissions, atomic updates, encrypted credentials, scheduler dispatch, cadence, pause behavior, stale edit rejection and rollback. The settings database fixture must be run before real credentials are configured; it rolls back all data and queued HTTP requests.

Official references: [API setup and signing](https://apidoc.lingxing.com/new/guides/new-instructions/), [warehouse inventory fields](https://apidoc.lingxing.com/new/api-docs/Warehouse/InventoryDetails/), [token endpoint](https://apidoc.lingxing.com/new/api-docs/Authorization/GetToken/), [Vercel scheduling limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).
