import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadMigrations, migrate, MigrationError } from "../src/db/migrate.js";
import { MIGRATIONS_DIR } from "../src/db/paths.js";
import { createTestDb } from "./helpers.js";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

/** Each test gets its own database: they all use version numbers like 001, so sharing one would collide. */
async function withDb<T>(fn: (pool: Awaited<ReturnType<typeof createTestDb>>["pool"]) => Promise<T>): Promise<T> {
  const own = await createTestDb();
  try {
    return await fn(own.pool);
  } finally {
    await own.drop();
  }
}

async function dirWith(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "migrations-"));
  for (const [name, sql] of Object.entries(files)) await writeFile(join(dir, name), sql);
  return dir;
}

describe("migration runner", () => {
  it("is idempotent: the second run applies nothing", async () => {
    const first = await migrate(db.pool, MIGRATIONS_DIR);
    expect(first.applied).toEqual(["001_init.sql", "002_idempotency.sql"]);
    const second = await migrate(db.pool, MIGRATIONS_DIR);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toEqual(["001_init.sql", "002_idempotency.sql"]);
    const { rows } = await db.pool.query<{ n: number }>("select count(*)::int as n from schema_migrations");
    expect(rows[0]?.n).toBe(2);
  });

  it("applies only the new file when one is added", async () => {
    await withDb(async (pool) => {
      const dir = await dirWith({ "001_a.sql": "create table a1 (id int);" });
      await migrate(pool, dir);
      await writeFile(join(dir, "002_b.sql"), "create table b1 (id int);");
      expect((await migrate(pool, dir)).applied).toEqual(["002_b.sql"]);
    });
  });

  it("refuses a file that ends the runner's transaction, before running any of it", async () => {
    await withDb(async (pool) => {
      const dir = await dirWith({ "001_sneaky.sql": "create table sneaky_t (id int);\ncommit;\nselect * from does_not_exist;" });
      await expect(migrate(pool, dir)).rejects.toThrow(/001_sneaky.sql.*transaction/);
      const { rows } = await pool.query<{ t: string | null }>("select to_regclass('sneaky_t') as t");
      expect(rows[0]?.t).toBeNull();
    });
  });

  it.each(["BEGIN", "end", "Rollback", "abort", "start transaction", "/* x */ -- y\n commit work"])(
    "refuses the statement %j",
    async (statement) => {
      const dir = await dirWith({ "001_a.sql": `select 1;\n${statement};\n` });
      await expect(loadMigrations(dir)).rejects.toThrow(MigrationError);
    },
  );

  it("accepts those words inside strings, comments, names and function bodies", async () => {
    await withDb(async (pool) => {
      const dir = await dirWith({
        "001_words.sql": [
          "-- commit; rollback;",
          "/* begin; /* nested */ end; */",
          "create table commit_log (\"end\" text default 'it''s; commit;', e text default E'\\'; rollback;');",
          "create function noop() returns void language plpgsql as $body$ begin null; end; $body$;",
          "do $$ begin perform 1; end $$;",
          "savepoint s; rollback to savepoint s; rollback work to s;",
        ].join("\n"),
      });
      expect((await migrate(pool, dir)).applied).toEqual(["001_words.sql"]);
    });
  });

  it("applies files in numeric order, not alphabetical order", async () => {
    await withDb(async (pool) => {
      const dir = await dirWith({ "999_first.sql": "create table n1 (id int);", "1000_second.sql": "alter table n1 add column x int;" });
      expect((await migrate(pool, dir)).applied).toEqual(["999_first.sql", "1000_second.sql"]);
    });
  });

  it("refuses two spellings of one version", async () => {
    const dir = await dirWith({ "001_a.sql": "select 1;", "0001_b.sql": "select 1;" });
    await expect(loadMigrations(dir)).rejects.toThrow(/share version/);
  });

  it("refuses a new file older than one already applied", async () => {
    await withDb(async (pool) => {
      const dir = await dirWith({ "001_a.sql": "create table o1 (id int);", "003_c.sql": "create table o3 (id int);" });
      await migrate(pool, dir);
      await writeFile(join(dir, "002_b.sql"), "create table o2 (id int);");
      await expect(migrate(pool, dir)).rejects.toThrow(/002_b.sql is older than 003_c.sql/);
      const { rows } = await pool.query<{ t: string | null }>("select to_regclass('o2') as t");
      expect(rows[0]?.t).toBeNull();
    });
  });

  it("rolls back a failing migration completely and records nothing", async () => {
    await withDb(async (pool) => {
      const dir = await dirWith({
        "001_ok.sql": "create table ok_t (id int);",
        "002_bad.sql": "create table half_t (id int); select * from does_not_exist;",
      });
      await expect(migrate(pool, dir)).rejects.toThrow(/002_bad.sql failed and was rolled back/);
      const half = await pool.query<{ t: string | null }>("select to_regclass('half_t') as t");
      expect(half.rows[0]?.t).toBeNull();
      const rec = await pool.query("select name from schema_migrations where name like '%_bad.sql' or name = '001_ok.sql'");
      expect(rec.rows.map((r: { name: string }) => r.name)).toEqual(["001_ok.sql"]);
    });
  });

  it("refuses to run when an applied migration was edited", async () => {
    await withDb(async (pool) => {
      const dir = await dirWith({ "001_x.sql": "create table edit_t (id int);" });
      await migrate(pool, dir);
      await writeFile(join(dir, "001_x.sql"), "create table edit_t (id int, extra int);");
      await expect(migrate(pool, dir)).rejects.toThrow(/changed after it was applied. Add a new migration/);
    });
  });

  it("refuses to run when an applied migration's file is gone", async () => {
    await withDb(async (pool) => {
      const dir = await dirWith({ "001_y.sql": "create table gone_t (id int);" });
      await migrate(pool, dir);
      const other = await dirWith({ "002_z.sql": "select 1;" });
      await expect(migrate(pool, other)).rejects.toThrow(/file is missing/);
    });
  });

  it("concurrent runners apply each migration exactly once", async () => {
    const own = await createTestDb();
    try {
      const results = await Promise.all(Array.from({ length: 6 }, () => migrate(own.pool, MIGRATIONS_DIR)));
      const appliedCounts = results.map((r) => r.applied.length);
      expect(appliedCounts.filter((n) => n === 2)).toHaveLength(1);
      expect(appliedCounts.filter((n) => n === 0)).toHaveLength(5);
    } finally {
      await own.drop();
    }
  });

  it("rejects badly named and duplicate-version files", async () => {
    await expect(loadMigrations(await dirWith({ "init.sql": "" }))).rejects.toBeInstanceOf(MigrationError);
    await expect(loadMigrations(await dirWith({ "001_a.sql": "", "001_b.sql": "" }))).rejects.toThrow(/share version 001/);
  });
});
