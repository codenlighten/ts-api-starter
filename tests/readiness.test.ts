import { createServer, type Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createPool } from "../src/db/pool.js";
import { testConfig } from "./helpers.js";

/** A "database" that accepts the connection and then says nothing, as a silently dropped network does. */
async function silentServer() {
  const sockets: Socket[] = [];
  const server = createServer((s) => sockets.push(s));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || !address) throw new Error("no port");
  return {
    url: `postgres://app:app@127.0.0.1:${address.port}/app`,
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

describe("readiness when the database stops answering", () => {
  it("answers 503 within a few seconds instead of waiting", async () => {
    const silent = await silentServer();
    const pool = createPool(silent.url, 2, () => {});
    const app = await buildApp({ cfg: testConfig(), pool });
    try {
      const started = Date.now();
      const res = await app.inject({ url: "/readyz" });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ code: "database_unavailable" });
      expect(Date.now() - started).toBeLessThan(4000);
    } finally {
      await app.close();
      await silent.close();
      await pool.end();
    }
  }, 15_000);

  it("gives up on opening a connection, so other requests fail rather than queue for ever", async () => {
    const silent = await silentServer();
    const pool = createPool(silent.url, 2, () => {});
    try {
      await expect(pool.query("select 1")).rejects.toThrow(/timeout/i);
    } finally {
      await silent.close();
      await pool.end();
    }
  }, 15_000);
});
