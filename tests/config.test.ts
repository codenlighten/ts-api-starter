import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

const valid = { DATABASE_URL: "postgres://x/y", JWT_SECRET: "x".repeat(32) };

describe("config", () => {
  it("applies defaults and coerces numbers", () => {
    const cfg = loadConfig({ ...valid, PORT: "8080" });
    expect(cfg.PORT).toBe(8080);
    expect(cfg.TOKEN_TTL_SECONDS).toBe(3600);
  });

  it("refuses a short JWT secret and says what to do", () => {
    expect(() => loadConfig({ ...valid, JWT_SECRET: "short" })).toThrow(/JWT_SECRET: must be at least 32 characters/);
  });

  it("reports every problem at once, not just the first", () => {
    let message = "";
    try {
      loadConfig({ PORT: "banana" });
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      message = (err as Error).message;
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).toMatch(/JWT_SECRET/);
    expect(message).toMatch(/PORT/);
  });
});
