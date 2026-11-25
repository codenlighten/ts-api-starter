import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS_DIR } from "../src/db/paths.js";
import { migrate } from "../src/db/migrate.js";
import { createTestDb, testConfig } from "./helpers.js";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
  await migrate(db.pool, MIGRATIONS_DIR);
});
afterAll(async () => {
  await db.drop();
});

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

async function waitFor(url: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${url} never came up`);
}

describe("server process", () => {
  it("exits 2 with a readable message on bad config", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], { env: { PATH: process.env.PATH ?? "" } });
    let err = "";
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    const code = await new Promise((r) => child.on("exit", r));
    expect(code).toBe(2);
    expect(err).toMatch(/JWT_SECRET/);
  });

  it("on SIGTERM fails readiness first, then exits 0", async () => {
    const port = await freePort();
    const cfg = testConfig();
    const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
      env: {
        PATH: process.env.PATH ?? "",
        DATABASE_URL: db.url,
        JWT_SECRET: cfg.JWT_SECRET,
        PORT: String(port),
        LOG_LEVEL: "silent",
        SHUTDOWN_DELAY_MS: "1500",
      },
    });
    const exited = new Promise<number | null>((r) => child.on("exit", r));
    await waitFor(`http://127.0.0.1:${port}/readyz`);
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 400));
    const during = await fetch(`http://127.0.0.1:${port}/readyz`);
    expect(during.status).toBe(503);
    expect(await exited).toBe(0);
  });
});
