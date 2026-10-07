# AI rate limits and spending allowances

All hosted agent, embedding, and Gemini thumbnail requests created by the application container pass through a shared admission guard. It derives the member ID from the authenticated server session, so request payloads cannot select another member's allowance. Server-side continuations retain the Next.js request context. Operator reindex/seed scripts use an explicit operator scope and also consume the global allowance.

Production stores counters and concurrency leases in PostgreSQL using migration `019_ai_usage_limits.sql`. A transaction and shared advisory lock serialize admission across instances: checking every scope and reserving spend either all succeed or all roll back. A missing migration, unavailable database, or failed authentication blocks outbound provider work. In-memory counters are limited to development/tests.

| Variable | Default | Meaning |
| --- | --- | --- |
| `AI_USER_REQUESTS_PER_MINUTE` | 20 | Maximum provider attempts per member per UTC minute |
| `AI_GLOBAL_REQUESTS_PER_MINUTE` | 120 | Maximum attempts across members and operator scripts per UTC minute |
| `AI_USER_DAILY_BUDGET_USD` | 5 | Per-member daily reserved-cost allowance |
| `AI_GLOBAL_DAILY_BUDGET_USD` | 100 | Daily reserved-cost allowance across all members/operator scripts |
| `AI_USER_CONCURRENCY` | 2 | Maximum simultaneous provider calls per member |
| `AI_GLOBAL_CONCURRENCY` | 8 | Maximum simultaneous provider calls across all instances |
| `AI_MAX_INPUT_BYTES` | 65536 | Maximum serialized provider request bytes |
| `AI_MAX_OUTPUT_TOKENS` | 4096 | Maximum output allocation for a text-generation call |
| `AI_INPUT_USD_PER_MILLION_TOKENS` | 10 | Input price ceiling used to estimate reservations |
| `AI_OUTPUT_USD_PER_MILLION_TOKENS` | 30 | Output price ceiling used to estimate reservations |

Set the price ceilings to at least the highest prices of **every configured model**, including embedding and thumbnail models, and include reasoning-output pricing where applicable. Price defaults are configurable estimates, not a verified pricing feed. The guard allows only configured models and the application's text/embedding endpoints; it rejects streaming, built-in paid tools, and audio/modalities.

Before sending a request, the guard reserves `(serialized UTF-8 bytes + 1024 framing tokens) × input price + allocated output tokens × output price`, rounded up to whole USD micro-units. UTF-8 bytes conservatively estimate text token count. Embeddings reserve input cost only. The full reservation stays charged even if the provider fails or times out, because the provider may have processed it. There are no refunds based on missing or unverifiable usage metadata. This intentionally overestimates typical spend, so an allowance may run out before that amount is billed. It is not invoice accounting or a guarantee against provider fees outside the configured token-price model; retain provider-side project spend limits too.

Minute/day windows use the database clock. Daily allowances reset at **00:00 UTC / 08:00 Singapore time**. Concurrency is held through response-body consumption. Requests time out after 90 seconds; abandoned leases expire after 120 seconds. Expired counters/leases are cleaned during admission. A failed lease release leaves the lease until expiry, reducing available capacity instead of bypassing the limit.

Limit and budget denials return HTTP 429 with a stable `AI_RATE_LIMITED`, `AI_BUDGET_EXHAUSTED`, or `AI_BUSY` code and `Retry-After`. Guard outages return 503. Excess provider input returns 413. Both the SDK and agent retry policies stop on application denials. Ordinary provider/network retries remain subject to fresh admission and a fresh reservation. Background assistant work records the same safe error in its existing workflow status; optional image generation falls back to its existing placeholder.

Railway's predeploy command and the Docker startup command apply the migration automatically. Configure overrides through environment variables; Compose's existing `env_file` passes them to the API. No real secrets are required in the migration. The application runtime also validates that configured limits are positive and cannot silently switch to in-memory accounting in production.

These controls bound outbound AI work. They do not replace account-abuse prevention, edge/body-size limits, or protections for non-AI endpoints. The provider input limit applies after application JSON parsing; ingress payload limits remain a separate deployment control.

## Verification

The regression tests cover burst admission, member/global rate and budget separation, SDK retries, failed-call charging, response-body concurrency, missing authentication, oversized input, and background/operator attribution. PostgreSQL tests use two independent pools to race admission and confirm that denied work rolls back all counters, state survives store recreation, and a missing migration blocks provider calls.

Run the local suites with Node 22 or newer. The PostgreSQL suite requires a disposable local database and two explicit opt-in variables:

```bash
AI_LIMIT_TEST_DATABASE_URL=postgresql://<user>@127.0.0.1:<port>/<disposable-db> \
AI_LIMIT_TEST_DATABASE_ISOLATED=YES npm test
```

That suite creates the admission tables and truncates them between tests. Use a database created specifically for this test; ordinary `DATABASE_URL` does not enable it. Without these variables, PostgreSQL admission tests are skipped.
