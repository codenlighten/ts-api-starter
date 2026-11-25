import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signToken } from "../src/auth/token.js";
import { signup, startApp, type TestApp } from "./helpers.js";

let t: TestApp;
beforeAll(async () => {
  t = await startApp({ TOKEN_TTL_SECONDS: "60" });
});
afterAll(async () => {
  await t.close();
});

const login = (email: string, password: string) =>
  t.app.inject({ method: "POST", url: "/v1/auth/login", payload: { email, password } });

describe("auth", () => {
  it("signup returns a token that works on /v1/me", async () => {
    const acct = await signup(t.app, "Globex");
    const me = await t.app.inject({ method: "GET", url: "/v1/me", headers: acct.auth });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: acct.email, tenantName: "Globex" });
  });

  it("stores a scrypt hash, never the password", async () => {
    const acct = await signup(t.app);
    const { rows } = await t.pool.query<{ password_hash: string }>("select password_hash from users where email = $1", [acct.email]);
    expect(rows[0]?.password_hash).toMatch(/^scrypt\$/);
    expect(rows[0]?.password_hash).not.toContain("correct horse");
  });

  it("login works with the right password, mixed-case email included", async () => {
    const acct = await signup(t.app);
    const res = await login(acct.email.toUpperCase(), "correct horse battery");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("token");
  });

  it("login gives the same 401 for a wrong password and an unknown email", async () => {
    const acct = await signup(t.app);
    const wrong = await login(acct.email, "not the password");
    const unknown = await login("nobody@example.com", "not the password");
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().detail).toBe(unknown.json().detail);
  });

  it("rejects a duplicate email with 409", async () => {
    const acct = await signup(t.app);
    const res = await t.app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { tenantName: "Dup", email: acct.email, password: "correct horse battery" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("email_taken");
  });

  it("validates signup input with field-level errors", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: { tenantName: "", email: "nope", password: "short" },
    });
    expect(res.statusCode).toBe(400);
    const paths = (res.json().errors as { path: string }[]).map((e) => e.path).sort();
    expect(paths).toEqual(["email", "password", "tenantName"]);
  });

  it("requires a bearer token", async () => {
    for (const headers of [{}, { authorization: "Basic abc" }, { authorization: "Bearer not.a.token" }]) {
      const res = await t.app.inject({ method: "GET", url: "/v1/me", headers });
      expect(res.statusCode).toBe(401);
      expect(res.headers["content-type"]).toContain("application/problem+json");
    }
  });

  it("rejects an expired token", async () => {
    const acct = await signup(t.app);
    const me = await t.app.inject({ method: "GET", url: "/v1/me", headers: acct.auth });
    const { userId, tenantId } = me.json<{ userId: string; tenantId: string }>();
    const expired = signToken({ userId, tenantId }, t.cfg.JWT_SECRET, 60, Date.now() - 120_000);
    const res = await t.app.inject({ method: "GET", url: "/v1/me", headers: { authorization: `Bearer ${expired}` } });
    expect(res.statusCode).toBe(401);
    expect(res.json().detail).toMatch(/expired/);
  });
});
