import pg from "pg";

export type Queryable = Pick<pg.Pool, "query">;

/**
 * Creates the connection pool. An idle connection can be killed from outside (database restart,
 * failover, an admin terminating the backend). pg then emits "error" on the pool, and with no
 * listener Node treats it as an unhandled error and the whole API process dies. Here the error is
 * reported through `onError` and the pool discards that connection and opens a new one on demand.
 */
export function createPool(connectionString: string, max = 10, onError: (err: Error) => void = defaultOnError): pg.Pool {
  const pool = new pg.Pool({ connectionString, max });
  pool.on("error", onError);
  return pool;
}

function defaultOnError(err: Error): void {
  console.error(JSON.stringify({ level: "error", msg: "idle database client error; the pool will reconnect", err: err.message }));
}

export async function withTx<T>(pool: pg.Pool, fn: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (err) {
    // If the rollback itself fails the connection is unusable: destroy it instead of returning it to the
    // pool, and keep the original error, which is the one the caller needs.
    await client.query("rollback").catch(() => {
      broken = true;
    });
    throw err;
  } finally {
    client.release(broken);
  }
}
