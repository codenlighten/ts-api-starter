# ts-api-starter

A multi-tenant projects-and-tasks HTTP API in Node 22 and strict TypeScript: Fastify, zod, Postgres through the `pg` driver, and a small SQL migration runner written for this repo. It shows back-end and API engineering with Postgres.

## Run it

Needs Node 22 and Docker.

```bash
docker compose up -d --wait && cp .env.example .env
npm ci
npm run migrate && npm run dev        # http://localhost:3000/openapi.json
```

Tests need the same Postgres (`npm test`; set `TEST_DATABASE_URL` to use another server). Each test file creates and drops its own database.

## What this proves

- **Tenant isolation is enforced in SQL, twice.** Every query filters on `tenant_id`, and `tasks` carries a composite foreign key `(tenant_id, project_id)`, so the database refuses a task that points at another tenant's project even if application code is wrong. Another tenant's ids return 404, not 403, so they do not leak existence.
- **Idempotency keys are transactional.** The key row and the created resource commit together; a concurrent request with the same key blocks on the unique index and then replays the stored response. Same key with a different request gives 422. A failed request rolls back its key, so it can be retried. A test fires 20 parallel POSTs with one key and expects one row.
- **A migration runner with guarantees**: one advisory lock (parallel runners apply each file once), one transaction per file (a failing file leaves no trace), checksums (editing an applied file, or deleting it, is an error).
- **Auth with no auth library**: scrypt password hashes with parameters stored in the hash, a small HS256 token implementation that accepts exactly one algorithm and checks expiry, the same 401 for unknown email and wrong password.
- **Operational basics**: env validated at boot with all problems listed, pino JSON logs with a request id on every line (bearer tokens redacted), RFC 9457 `application/problem+json` errors with a stable `code`, rate limits (stricter on auth), `/healthz`, `/readyz` that turns 503 while draining, graceful SIGTERM shutdown, and an OpenAPI 3.1 document generated from the same zod schemas that validate requests (`/openapi.json`).

## Layout

| Path | Job |
|---|---|
| `src/http/route.ts` | Route registrar: parses params, query, body and the idempotency header with zod, authenticates, and records each spec for OpenAPI |
| `src/http/openapi.ts`, `errors.ts` | Document generation; problem+json mapping |
| `src/idempotency.ts` | `runIdempotent`, the transactional key logic |
| `src/pagination.ts` | Keyset cursor over an identity column (`limit + 1` fetch), opaque cursor |
| `src/repo/*.ts` | All SQL, parameterised |
| `src/db/migrate.ts`, `migrations/` | Runner and plain `.sql` files |
| `src/auth/*.ts` | scrypt and token code |
| `tests/` | Vitest against a real Postgres |

Endpoints: `POST /v1/auth/signup`, `POST /v1/auth/login`, `GET /v1/me`, `POST|GET /v1/projects`, `GET /v1/projects/:id`, `POST|GET /v1/projects/:projectId/tasks`, `PATCH /v1/tasks/:id`.

## Tests and deliberate breaks

`tests/` covers auth, tenant isolation, pagination edges, idempotency replay, conflict and concurrency, the migration runner, problem+json, logs, rate limiting, OpenAPI, health and the shutdown process. The CI workflow runs typecheck, lint, tests and build with a `postgres:17` service container.

Status of this checkout, stated plainly: typecheck and lint pass, and the 12 tests that need no database (config, password, token, cursor codec) pass. **The database-backed tests have been written but not yet run, and the deliberate breaks (drop the tenant filter, break idempotency, skip token expiry, off-by-one in the cursor, skip migration recording) have not yet been performed.** The README will list them with the test that caught each once that has happened.

## Limits

- Rate limiting is in memory and per process; several instances would each count separately.
- Tokens cannot be revoked before they expire (no refresh tokens, no logout).
- One user per tenant: signup creates a tenant, and there are no invitations or roles.
- Idempotency records are never expired; a real deployment needs a cleanup job.
- Email addresses are unique across tenants, and there is no email verification or password reset.
- Pagination is newest-first only, with no total counts.
- No performance numbers have been measured.

## Dependencies

Fastify, @fastify/rate-limit, pino, pg and zod are third-party packages; everything else, including the migration runner, tokens and idempotency, is written here.

## Licence

MIT. See `LICENSE`.
