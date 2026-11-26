# ts-api-starter

[![CI](https://github.com/codenlighten/ts-api-starter/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/codenlighten/ts-api-starter/actions/workflows/ci.yml)

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

63 tests in 10 files pass against a real PostgreSQL 16 (one throwaway database per test file). CI runs the suite on a `postgres:17` service container and passes there too (GitHub Actions, 2026-11-25). A fresh clone passes `npm ci`, typecheck, lint, the tests and `npm run build`.

### What running it found

The first run of the database tests failed 6 of 61, and all of them were instructive:

- Four migration tests shared one database and collided on version `001` (a test-design bug, now one database per test).
- The rate-limit test shared an app with an earlier login test, which had already spent one of the three allowed attempts.
- A cursor test treated `"NDI"` as invalid, but it is the correct encoding of `42`. The non-canonical case is `"NDI="`.
- After those, vitest still reported 9 unhandled errors: **the connection pool had no `error` listener.** In node-postgres an idle connection killed from outside (database restart, failover, an admin terminating the backend) then crashes the whole Node process. `createPool` now reports the error and lets the pool reconnect, and `tests/pool.test.ts` kills an idle connection and checks the process survives. `withTx` also keeps the original error and destroys the connection if the rollback itself fails.

### Deliberate breaks

Each change below was made on its own, the full suite run, and the code restored (63 of 63 pass afterwards). Every break failed the tests named here.

| Break | Tests that failed |
|---|---|
| Drop the tenant filter in `getProject` | `tenancy`: tenant B reads A's project; tenant B lists or adds tasks in A's project |
| Idempotency key re-claimed instead of replayed | 4 `idempotency` tests, including 20 parallel requests creating one row |
| Skip the token expiry check | `auth` and `crypto`: rejects an expired token |
| Cursor off-by-one (`seq <=` instead of `<`) | 6 `pagination` tests (repeated rows, extra empty page) |
| Do not record applied migrations | 6 `migrate` tests (idempotent run, concurrent runners, edit detection) |
| Remove the pool error listener | `pool`: survives an idle connection being killed |
| Accept non-canonical cursors | `pagination`: cursor codec rejects anything it did not produce |

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
