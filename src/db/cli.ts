import { ConfigError, loadConfig } from "../config.js";
import { MIGRATIONS_DIR } from "./paths.js";
import { migrate } from "./migrate.js";
import { createPool } from "./pool.js";

try {
  const cfg = loadConfig(process.env);
  const pool = createPool(cfg.DATABASE_URL, 2);
  try {
    const { applied, alreadyApplied } = await migrate(pool, MIGRATIONS_DIR);
    console.log(applied.length ? `applied: ${applied.join(", ")}` : "nothing to apply");
    console.log(`already applied: ${alreadyApplied.length}`);
  } finally {
    await pool.end();
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = err instanceof ConfigError ? 2 : 1;
}
