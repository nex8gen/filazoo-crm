# 24-hour CRM agent evaluation

The requested allowance is **$5 total for this testing run**, not a new daily limit for normal CRM usage. The worker enforces a lower **$4.75** ceiling and the original 24-hour deadline across restarts. It uses current Gateway prices, maximum published context/cache-write/regional rates, and no cache discounts. These conservative charges can exceed the provider's actual token bill. The remaining $0.25 is a buffer, not extra spend authority.

The test exercises the actual `generateCrmPlan` SDK loop with synthetic records. It cannot access the production CRM database or execute proposed business actions. No actual customer messages, invoices, product changes, team changes or settings writes occur. Credentials are used only to authenticate model calls.

## Coverage and limits

The suite covers all 58 currently registered action schemas on both configured agent models, plus natural requests, spelling errors, monetary conversions, email drafts, shipping details, generated follow-up replies, 123-message conversation corrections, document changes, denied permissions, read-only requests and malicious text in customer emails. Nine additional live AI cases use the production instructions and parsers for customer chat, email reply/rewrite/summary, workflow reply/catalog selection, conversation tagging and customer-detail extraction. Long histories use the production `conversationMemory` and `memoryPrompt` functions. Structured action requests and natural conversation cases are reported separately by case kind; structured cases supply explicit requested values and do not establish broad natural-language reliability.

Offline tests separately verify valid and denied calls for every action through the actual SDK. Existing execution-service, route, history, isolation and policy tests remain the authority for those application boundaries. Live synthetic planning does not establish production delivery, business-service success, or unrestricted workflow compatibility.

Every possible prompt or conversation cannot be enumerated. This is regression evaluation and instruction correction, not fine-tuning or proof that the agent cannot fail. Failed baseline results are retained. One corrective retry may include the trusted expected result; a recovery is reported as **coached**, never substituted for an original pass or treated as a production agent improvement. Production instructions and code need separately reviewed changes and fresh uncoached checks when a real defect is identified. No unattended process writes or deploys model-generated code.

## Running and monitoring

```powershell
npm.cmd run ai:eval:plan
npm.cmd run ai:eval:24h
npm.cmd run ai:eval:status
```

One exclusive worker lock protects this run. A second worker is rejected. Dead process locks can be recovered, but the budget and deadline never reset. Keep the machine awake and connected; an interrupted worker must be resumed using the same command and directory. The run directory is fixed at `tmp/agent-soak-20261105` so restarting the command does not accidentally authorize another $5. Never delete that directory or its budget ledger to resume this authorized run.

The first pass checks each case on both agent models. Afterward, batches of four cases run at least 15 minutes apart; the worker lengthens the interval using observed cost and remaining time to spread the allowance across the run. Selected offline regression tests repeat hourly with credentials stripped from the child process. A failing offline suite pauses paid testing until the next successful check. Budget exhaustion or uncertain underpricing stops paid calls; hourly offline checks continue until the deadline.

Create `tmp/agent-soak-20261105/STOP` to stop at the next case boundary. Remove only that STOP file to resume. The active provider call has a maximum 60-second timeout. No calls are launched after the saved deadline.

## Evidence

- `tmp/agent-soak-20261105/budget.json`: persisted pre-call reservations, settled conservative charges, original deadline and cutoff.
- `tmp/agent-soak-20261105/progress.json`: heartbeat, process ID, counters, next case and offline status.
- `tmp/agent-soak-20261105/results.jsonl`: append-only baseline and coached results, proposed actions, failures, models, timing and history bounds.
- `tmp/agent-soak-20261105/report.json`: current suite coverage, untested gaps, original failures, coached recoveries and budget.
- `tmp/agent-soak-20261105/failure-replay.json`: preserved failing conversations for diagnosis and future regression checks.
- `tmp/agent-soak-20261105/manifest.json`: hashes of the evaluated source files; `suite-revisions.jsonl` records fixture corrections.
- `tmp/agent-soak-20261105/offline-tests.log`: recurring offline regression results.
- `tmp/agent-soak-worker.stdout.log` and `.stderr.log`: background worker output.

Reservations are written and flushed to disk before a paid request. Network loss, missing usage and crashes retain the full reservation. An invalid ledger, unsupported model/tool, pricing failure, raised saved ceiling, concurrent worker or expired deadline never grants a fresh allowance. The worker does not enable web search, image generation, provider-side tools, streaming, redirects, SDK retries or premium service tiers. The existing text-generation helper's bounded HTTP retry also passes through the same budget ledger for each attempt.

Initial local verification passed 1,446 tests, including the first 126 new checks, plus TypeScript and targeted lint. Adding AI text cases brought the new checks to 138. Subsequent evaluation results must be read from the running evidence; starting a 24-hour job is not a completed 24-hour result.

The later full repository run passed 1,473 tests. A history-hook test harness and missing Chinese loading text found by these checks were corrected. The initial duplicate-customer, unchanged-city and already-existing-member fixtures were corrected without resetting charged usage or deleting their original results.

Live evaluation found redundant chat authorization for an explicit administrator deletion request. The local agent instructions now stage the requested proposal for mandatory CRM review while preserving server permissions and validation. This is an instruction change, not model-weight training or a production deployment. `--recheck-failures` replays the latest failed scenarios without a coached answer before continuing normal coverage; all older failures remain in the evidence. The quotation checker also accepts equivalent saved-price lines when the customer's email verifies the exact product, variant and quantity.

Further live failures distinguished a variant SKU from the required parent product SKU in email invoice replies, and required nonempty draft acknowledgment fields during customer-detail extraction. Their production instructions were clarified and queued for uncoached rechecks. Native tool diagnostics now preserve validation errors and mixed batches in synthetic evidence. Fixture checks accept the verified saved quotation PDF and saved currency defaults; the long-history case explicitly asks for a new invoice so updating an existing draft is not an ambiguous alternative.

The email SKU and customer-detail fixes passed subsequent uncoached live rechecks. Order instructions now restrict reference-only edits to that one field; discarded mixed batches receive explicit repair feedback. Those live rechecks also passed, together with workflow creation and reply-wait checks. The suite now uses the production address-grounding helper so multiline address formatting is accepted while invented address facts are rejected. Current results and remaining coverage gaps are authoritative in `report.json`; historical failed attempts remain visible separately.

## Initial coverage checkpoint

On 2026-11-06, all **160 model/scenario pairs** had a passing latest uncoached result after corrections, covering 80 scenarios on each of the two agent models. Conservative test charges were **$2.375656**, with no outstanding reservations. The background worker remained active under the original **$4.75** limit until **2026-11-07 08:19:21 Asia/Shanghai**. This checkpoint is not a completed 24-hour result.

Final local verification passed **1,488 repository tests**, **170 focused checks**, TypeScript and targeted lint. The saved [initial coverage evidence](audit-evidence/agent-24h-baseline-20261106.json) includes model counts, source hashes, raw failure summaries, budget and scope. Live repeated results continue in the run directory. No production deployment or model-weight fine-tuning occurred.
