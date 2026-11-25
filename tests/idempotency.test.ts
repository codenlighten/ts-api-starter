import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject, signup, startApp, type Account, type TestApp } from "./helpers.js";

let t: TestApp;
let a: Account;
beforeAll(async () => {
  t = await startApp();
  a = await signup(t.app);
});
afterAll(async () => {
  await t.close();
});

const post = (acct: Account, key: string | undefined, name: string) =>
  t.app.inject({
    method: "POST",
    url: "/v1/projects",
    headers: { ...acct.auth, ...(key ? { "idempotency-key": key } : {}) },
    payload: { name },
  });
const count = async (): Promise<number> => (await t.pool.query<{ n: number }>("select count(*)::int as n from projects")).rows[0]?.n ?? -1;

describe("idempotency keys", () => {
  it("replays the stored response and creates one row", async () => {
    const before = await count();
    const first = await post(a, "replay-1", "Once");
    const second = await post(a, "replay-1", "Once");
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(first.headers["idempotent-replayed"]).toBeUndefined();
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(await count()).toBe(before + 1);
  });

  it("returns 422 when the key is reused with a different body", async () => {
    await post(a, "conflict-1", "First");
    const res = await post(a, "conflict-1", "Different");
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("idempotency_key_reused");
  });

  it("returns 422 when the key is reused on a different endpoint", async () => {
    const p = await createProject(t.app, a, "host");
    await post(a, "cross-1", "host");
    const res = await t.app.inject({
      method: "POST",
      url: `/v1/projects/${p.id}/tasks`,
      headers: { ...a.auth, "idempotency-key": "cross-1" },
      payload: { title: "host" },
    });
    expect(res.statusCode).toBe(422);
  });

  it("scopes keys per tenant: the same key in another tenant is a new request", async () => {
    const b = await signup(t.app, "Other");
    const one = await post(a, "shared-key", "mine");
    const two = await post(b, "shared-key", "mine");
    expect(two.headers["idempotent-replayed"]).toBeUndefined();
    expect(two.json().id).not.toBe(one.json().id);
  });

  it("without a key, every request creates a row", async () => {
    const before = await count();
    await post(a, undefined, "dup");
    await post(a, undefined, "dup");
    expect(await count()).toBe(before + 2);
  });

  it("a failed request does not burn the key", async () => {
    const missing = "6f1d1c0e-8a53-4e0e-9a55-2c5e0f1f9b11";
    const bad = await t.app.inject({
      method: "POST",
      url: `/v1/projects/${missing}/tasks`,
      headers: { ...a.auth, "idempotency-key": "retry-1" },
      payload: { title: "x" },
    });
    expect(bad.statusCode).toBe(404);
    const { rows } = await t.pool.query("select 1 from idempotency_keys where key = 'retry-1'");
    expect(rows).toHaveLength(0);
  });

  it("rejects a malformed key with 400", async () => {
    expect((await post(a, "has space", "x")).statusCode).toBe(400);
  });

  it("20 parallel requests with one key create exactly one row and all return the same body", async () => {
    const before = await count();
    const results = await Promise.all(Array.from({ length: 20 }, () => post(a, "parallel-1", "Parallel")));
    expect(results.map((r) => r.statusCode)).toEqual(Array<number>(20).fill(201));
    expect(new Set(results.map((r) => r.json<{ id: string }>().id)).size).toBe(1);
    expect(results.filter((r) => r.headers["idempotent-replayed"] === "true")).toHaveLength(19);
    expect(await count()).toBe(before + 1);
  });

  it("parallel requests with different keys create independent rows", async () => {
    const before = await count();
    await Promise.all(Array.from({ length: 8 }, (_, i) => post(a, `distinct-${i}`, "D")));
    expect(await count()).toBe(before + 8);
  });
});
