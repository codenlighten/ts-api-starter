import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signup, startApp, type TestApp } from "./helpers.js";

const lines: string[] = [];
const sink = new Writable({
  write(chunk: Buffer, _enc, cb) {
    lines.push(chunk.toString());
    cb();
  },
});

let t: TestApp;
beforeAll(async () => {
  t = await startApp({ LOG_LEVEL: "info", RATE_LIMIT_MAX: "30", AUTH_RATE_LIMIT_MAX: "3" }, sink);
});
afterAll(async () => {
  await t.close();
});

describe("errors, ids and logs", () => {
  it("unknown routes return problem+json with the request id", async () => {
    const res = await t.app.inject({ method: "GET", url: "/nope", headers: { "x-request-id": "abc-123" } });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.headers["x-request-id"]).toBe("abc-123");
    expect(res.json()).toMatchObject({ status: 404, code: "not_found", requestId: "abc-123" });
  });

  it("replaces an unsafe incoming request id with a generated one", async () => {
    const res = await t.app.inject({ method: "GET", url: "/healthz", headers: { "x-request-id": "bad id\twith spaces" } });
    expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("malformed JSON is a 400 problem, not a 500", async () => {
    const res = await t.app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/problem+json");
  });

  it("logs JSON with the request id and never the bearer token", async () => {
    const acct = await signup(t.app);
    lines.length = 0;
    await t.app.inject({ method: "GET", url: "/v1/me", headers: { ...acct.auth, "x-request-id": "log-test-1" } });
    const parsed = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed.every((l) => l.reqId === "log-test-1")).toBe(true);
    expect(lines.join("")).not.toContain(acct.token);
  });
});

describe("health", () => {
  it("healthz and readyz are ok", async () => {
    expect((await t.app.inject({ url: "/healthz" })).statusCode).toBe(200);
    expect((await t.app.inject({ url: "/readyz" })).json()).toEqual({ status: "ok" });
  });

  it("readyz reports 503 while draining, healthz stays 200", async () => {
    t.app.lifecycle.draining = true;
    try {
      const res = await t.app.inject({ url: "/readyz" });
      expect(res.statusCode).toBe(503);
      expect(res.headers["content-type"]).toContain("application/problem+json");
      expect(res.json()).toMatchObject({ status: 503, code: "draining", title: "Service Unavailable" });
      expect((await t.app.inject({ url: "/healthz" })).statusCode).toBe(200);
    } finally {
      t.app.lifecycle.draining = false;
    }
  });
});

describe("openapi", () => {
  it("documents the 503 that readiness can answer", async () => {
    const doc = (await t.app.inject({ url: "/openapi.json" })).json<{ paths: Record<string, { get: { responses: Record<string, unknown> } }> }>();
    expect(Object.keys(doc.paths["/readyz"]?.get.responses ?? {})).toContain("503");
    expect(Object.keys(doc.paths["/healthz"]?.get.responses ?? {})).not.toContain("503");
  });

  it("is generated from the route schemas", async () => {
    const doc = (await t.app.inject({ url: "/openapi.json" })).json<{
      openapi: string;
      paths: Record<string, Record<string, { requestBody?: { content: Record<string, { schema: { required?: string[] } }> }; parameters?: { name: string }[] }>>;
    }>();
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toContain("/v1/projects/{projectId}/tasks");
    const signupBody = doc.paths["/v1/auth/signup"]?.post?.requestBody?.content["application/json"]?.schema;
    expect(signupBody?.required?.sort()).toEqual(["email", "password", "tenantName"]);
    const names = doc.paths["/v1/projects"]?.post?.parameters?.map((p) => p.name);
    expect(names).toContain("Idempotency-Key");
  });
});

describe("rate limiting", () => {
  // Its own app: the limiter counts per route, so requests made by other tests must not use up the budget.
  let rl: TestApp;
  beforeAll(async () => {
    rl = await startApp({ RATE_LIMIT_MAX: "30", AUTH_RATE_LIMIT_MAX: "3" });
  });
  afterAll(async () => {
    await rl.close();
  });

  it("limits auth endpoints tighter and answers with problem+json and Retry-After", async () => {
    const codes: number[] = [];
    let last;
    for (let i = 0; i < 5; i++) {
      last = await rl.app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: "x@example.com", password: "whatever" } });
      codes.push(last.statusCode);
    }
    expect(codes).toEqual([401, 401, 401, 429, 429]);
    expect(last?.headers["content-type"]).toContain("application/problem+json");
    expect(last?.headers["retry-after"]).toBeDefined();
    expect(last?.json()).toMatchObject({ code: "rate_limited" });
  });

  it("never limits health checks", async () => {
    for (let i = 0; i < 40; i++) expect((await rl.app.inject({ url: "/healthz" })).statusCode).toBe(200);
  });
});
