# Railway deployment

This service is configured as a Dockerfile deployment through [`railway.json`](../railway.json). Railway runs the production environment validation and numbered PostgreSQL migrations before starting `node server.js`, then waits for `/health` to return HTTP 200.

## 1. Create the services

Create a Railway PostgreSQL service in the same project, then create the web service from this repository. Set the web service's `DATABASE_URL` to the PostgreSQL service reference, for example:

```text
${{Postgres.DATABASE_URL}}
```

Generate a public domain for the web service and use that HTTPS URL for `BETTER_AUTH_URL`.

## 2. Required web-service variables

Set these in Railway Variables. Keep secrets sealed and never commit their values.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `BETTER_AUTH_SECRET` | Random string of at least 32 characters |
| `BETTER_AUTH_URL` | `https://<your-public-domain>` |
| `AGENT_PROVIDER` | `gemini` or `openai` |
| `GEMINI_API_KEY` | Required when `AGENT_PROVIDER=gemini` |
| `OPENAI_API_KEY` | Required when `AGENT_PROVIDER=openai` |
| `DEMO_SEED_ENABLED` | `false` |
| `AVATAR_STORAGE_DIR` | `/app/.data/avatars` |
| `QUEST_IMAGE_STORAGE_DIR` | `/app/.data/quest-images` |
| `REWARD_CODE_ENCRYPTION_KEY` | Random 32-byte key encoded as 64 hex characters or base64 |
| `REWARD_CODE_FINGERPRINT_KEY` | Separate high-entropy secret used to fingerprint imported codes |

Railway supplies `PORT`; do not hard-code it in service variables. Optional model, logging, Google OAuth, and reward-code rotation variables are listed in [`.env.example`](../.env.example).

## 3. Persistent uploads

Attach a Railway volume mounted at `/app/.data`. Without a volume, database-backed member data remains durable but uploaded avatars and generated quest images are lost when the container is replaced.

## 4. Import reward inventory

After the app service can reach PostgreSQL, import one code per line from a secure operator machine. Do not put bearer codes in command arguments or commit them:

```bash
printf '%s\n' 'PARTNER-CODE-001' 'PARTNER-CODE-002' \
  | DATABASE_URL='...' \
    REWARD_CODE_ENCRYPTION_KEY='...' \
    REWARD_CODE_FINGERPRINT_KEY='...' \
    node scripts/import-reward-codes.mjs sunrise-cafe-set
```

The service refuses to start if the required production variables are absent or invalid. It does not fall back to in-memory stores, localhost PostgreSQL, deterministic agents, demo seed data, or a default auth secret in production.

## 5. Verify

After deployment, check:

```bash
curl -fsS https://<your-public-domain>/health
```

The response must report `status: "ok"`, PostgreSQL and pgvector ready, an indexed embedding state, and the configured hosted agent provider ready.
