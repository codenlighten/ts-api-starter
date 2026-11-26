import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { startApp, testConfig } from "./helpers.js";

const login = (app: Awaited<ReturnType<typeof startApp>>["app"], remoteAddress: string, client: string) =>
  app.inject({
    method: "POST",
    url: "/v1/auth/login",
    remoteAddress,
    headers: { "x-forwarded-for": client },
    payload: { email: "nobody@example.com", password: "wrong password here" },
  });

describe("rate limits behind a proxy", () => {
  it("counts each client separately when the request comes from a trusted proxy", async () => {
    const t = await startApp({ AUTH_RATE_LIMIT_MAX: "2", TRUSTED_PROXIES: "10.0.0.1, 10.0.0.2" });
    try {
      const codes = [];
      for (const client of ["203.0.113.5", "203.0.113.5", "203.0.113.5", "198.51.100.7"]) {
        codes.push((await login(t.app, "10.0.0.1", client)).statusCode);
      }
      expect(codes).toEqual([401, 401, 429, 401]);
    } finally {
      await t.close();
    }
  });

  it("ignores the forwarded address from anyone else, so it cannot be used to dodge the limit", async () => {
    const settings: Record<string, string>[] = [{}, { TRUSTED_PROXIES: "10.0.0.1" }];
    for (const overrides of settings) {
      const t = await startApp({ AUTH_RATE_LIMIT_MAX: "2", ...overrides });
      try {
        const codes = [];
        for (const client of ["203.0.113.5", "203.0.113.6", "203.0.113.7"]) {
          codes.push((await login(t.app, "192.0.2.99", client)).statusCode);
        }
        expect(codes).toEqual([401, 401, 429]);
      } finally {
        await t.close();
      }
    }
  });

  it("accepts addresses and ranges, and refuses anything else at boot", () => {
    expect(testConfig({ TRUSTED_PROXIES: "10.0.0.0/8,::1" }).TRUSTED_PROXIES).toEqual(["10.0.0.0/8", "::1"]);
    expect(testConfig().TRUSTED_PROXIES).toEqual([]);
    for (const bad of ["true", "10.0.0.1/33", "example.com", "10.0.0.1;10.0.0.2"]) {
      expect(() => loadConfig({ DATABASE_URL: "postgres://x", JWT_SECRET: "x".repeat(32), TRUSTED_PROXIES: bad })).toThrow(/TRUSTED_PROXIES/);
    }
  });
});
