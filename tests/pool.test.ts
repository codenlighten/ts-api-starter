import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool, withTx } from "../src/db/pool.js";
import { createTestDb } from "./helpers.js";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

describe("connection pool", () => {
  it("survives an idle connection being killed, reports it, and reconnects", async () => {
    const seen: Error[] = [];
    const pool = createPool(db.url, 2, (err) => seen.push(err));
    try {
      expect(pool.listenerCount("error")).toBeGreaterThan(0); // without a listener Node would crash on the error below
      await pool.query("select 1"); // opens one connection and leaves it idle in the pool
      await db.pool.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and application_name = ''");
      await new Promise((resolve) => setTimeout(resolve, 200)); // let the FATAL message arrive
      expect(seen.length).toBeGreaterThan(0);
      expect((await pool.query("select 1 as ok")).rows[0]).toEqual({ ok: 1 }); // a fresh connection is made on demand
    } finally {
      await pool.end();
    }
  });

  it("withTx rolls back on error and returns the original error", async () => {
    await db.pool.query("create table if not exists tx_t (id int)");
    await expect(
      withTx(db.pool, async (tx) => {
        await tx.query("insert into tx_t values (1)");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await db.pool.query("select count(*)::int as n from tx_t")).rows[0]).toEqual({ n: 0 });
  });
});
