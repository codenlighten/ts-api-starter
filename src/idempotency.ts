import { createHash } from "node:crypto";
import type pg from "pg";
import { withTx } from "./db/pool.js";
import { HttpError } from "./http/errors.js";
import type { Reply } from "./http/route.js";

export interface Stored {
  status: number;
  body: unknown;
}
export interface IdempotentResult extends Stored {
  replayed: boolean;
}

export function toReply(out: IdempotentResult): Reply {
  const headers: Record<string, string> = out.replayed ? { "idempotent-replayed": "true" } : {};
  return { status: out.status, body: out.body, headers };
}

export function fingerprint(method: string, path: string, body: unknown): string {
  return createHash("sha256").update(JSON.stringify([method, path, body])).digest("hex");
}

/**
 * Runs `work` at most once per (tenant, key). The key row and the work commit in
 * the same transaction, so there is no state where the resource exists without
 * its key or the reverse. A concurrent request with the same key blocks on the
 * unique index until the first transaction finishes, then replays its response.
 * A request that fails is rolled back with its key, so the client may retry it.
 */
export async function runIdempotent(
  pool: pg.Pool,
  args: { tenantId: string; key: string | undefined; fingerprint: string },
  work: (tx: pg.PoolClient) => Promise<Stored>,
): Promise<IdempotentResult> {
  const { tenantId, key } = args;
  if (key === undefined) return { ...(await withTx(pool, work)), replayed: false };

  return withTx(pool, async (tx) => {
    const claim = await tx.query(
      `insert into idempotency_keys (tenant_id, key, request_hash) values ($1, $2, $3)
       on conflict (tenant_id, key) do nothing returning key`,
      [tenantId, key, args.fingerprint],
    );
    if (claim.rowCount === 0) {
      const { rows } = await tx.query<{ request_hash: string; status_code: number; response_body: unknown }>(
        "select request_hash, status_code, response_body from idempotency_keys where tenant_id = $1 and key = $2",
        [tenantId, key],
      );
      const stored = rows[0];
      if (!stored) throw new HttpError(409, "idempotency_conflict", "The key was released while it was being read. Retry the request.");
      if (stored.request_hash !== args.fingerprint) {
        throw new HttpError(
          422,
          "idempotency_key_reused",
          "This Idempotency-Key was already used for a different request. Use a new key for a new request.",
        );
      }
      return { status: stored.status_code, body: stored.response_body, replayed: true };
    }
    const result = await work(tx);
    await tx.query("update idempotency_keys set status_code = $3, response_body = $4 where tenant_id = $1 and key = $2", [
      tenantId,
      key,
      result.status,
      JSON.stringify(result.body),
    ]);
    return { ...result, replayed: false };
  });
}
