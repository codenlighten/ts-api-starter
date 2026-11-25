import { buildApp } from "./app.js";
import { ConfigError, loadConfig, type Config } from "./config.js";
import { createPool } from "./db/pool.js";

function readConfig(): Config {
  try {
    return loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(2);
    }
    throw err;
  }
}

const cfg = readConfig();

// The logger does not exist until the app is built, so the pool reports through a late-bound reference.
let log: { error: (obj: object, msg: string) => void } = { error: (obj, msg) => console.error(msg, obj) };
const pool = createPool(cfg.DATABASE_URL, 10, (err) => log.error({ err }, "idle database client error; the pool will reconnect"));
const app = await buildApp({ cfg, pool });
log = app.log;
await app.listen({ port: cfg.PORT, host: "0.0.0.0" });

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, "shutting down");
  // Hard stop if draining hangs, so an orchestrator never waits forever.
  setTimeout(() => process.exit(1), cfg.SHUTDOWN_TIMEOUT_MS).unref();
  // Fail /readyz first so a load balancer stops sending traffic, then stop accepting and finish in-flight requests.
  app.lifecycle.draining = true;
  await new Promise((resolve) => setTimeout(resolve, cfg.SHUTDOWN_DELAY_MS));
  await app.close();
  await pool.end();
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => void shutdown(signal));
