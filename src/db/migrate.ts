import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type pg from "pg";

export class MigrationError extends Error {}

export interface MigrationFile {
  version: string;
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrateResult {
  applied: string[];
  alreadyApplied: string[];
}

// Arbitrary constant: all runners take the same advisory lock, so two
// processes starting at once cannot apply the same migration twice.
const LOCK_KEY = 726_351_001;
const FILE_PATTERN = /^(\d{3,})_([a-z0-9_]+)\.sql$/;

export async function loadMigrations(dir: string): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith(".sql")).sort();
  const seen = new Set<string>();
  const out: MigrationFile[] = [];
  for (const file of names) {
    const m = FILE_PATTERN.exec(file);
    if (!m) throw new MigrationError(`Bad migration file name "${file}": use NNN_snake_case.sql.`);
    const version = m[1] as string;
    if (seen.has(version)) throw new MigrationError(`Two migrations share version ${version}.`);
    seen.add(version);
    const sql = await readFile(join(dir, file), "utf8");
    out.push({ version, name: file, sql, checksum: createHash("sha256").update(sql).digest("hex") });
  }
  return out;
}

export async function migrate(pool: pg.Pool, dir: string): Promise<MigrateResult> {
  const files = await loadMigrations(dir);
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(`create table if not exists schema_migrations (
      version text primary key,
      name text not null,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`);
    const { rows } = await client.query<{ version: string; name: string; checksum: string }>(
      "select version, name, checksum from schema_migrations order by version",
    );
    const done = new Map(rows.map((r) => [r.version, r]));
    const byVersion = new Map(files.map((f) => [f.version, f]));

    for (const row of rows) {
      const file = byVersion.get(row.version);
      if (!file) {
        throw new MigrationError(`Migration ${row.name} was applied but its file is missing. Restore it; do not delete applied migrations.`);
      }
      if (file.checksum !== row.checksum) {
        throw new MigrationError(`Migration ${row.name} changed after it was applied. Add a new migration instead of editing an old one.`);
      }
    }

    const result: MigrateResult = { applied: [], alreadyApplied: rows.map((r) => r.name) };
    for (const file of files) {
      if (done.has(file.version)) continue;
      try {
        await client.query("begin");
        await client.query(file.sql);
        await client.query("insert into schema_migrations (version, name, checksum) values ($1, $2, $3)", [
          file.version,
          file.name,
          file.checksum,
        ]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw new MigrationError(`Migration ${file.name} failed and was rolled back: ${(err as Error).message}`);
      }
      result.applied.push(file.name);
    }
    return result;
  } finally {
    await client.query("select pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
