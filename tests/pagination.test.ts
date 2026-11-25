import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, toPage } from "../src/pagination.js";
import { signup, startApp, type Account, type TestApp } from "./helpers.js";

describe("cursor codec", () => {
  it("round-trips and rejects anything it did not produce", () => {
    expect(decodeCursor(encodeCursor("42"))).toBe("42");
    expect(decodeCursor(undefined)).toBeNull();
    for (const bad of ["", "!!!", encodeCursor("0"), encodeCursor("-1"), encodeCursor("1; drop table x"), "NDI"]) {
      expect(() => decodeCursor(bad)).toThrow(/cursor is not valid/);
    }
  });

  it("toPage only emits a cursor when the extra row proves there is more", () => {
    const rows = [{ seq: "3" }, { seq: "2" }, { seq: "1" }];
    expect(toPage(rows, 2, (r) => r.seq)).toEqual({ items: ["3", "2"], nextCursor: encodeCursor("2") });
    expect(toPage(rows, 3, (r) => r.seq)).toEqual({ items: ["3", "2", "1"], nextCursor: null });
    expect(toPage([], 3, (r: { seq: string }) => r.seq)).toEqual({ items: [], nextCursor: null });
  });
});

let t: TestApp;
let acct: Account;
beforeAll(async () => {
  t = await startApp();
  acct = await signup(t.app);
  for (let i = 1; i <= 7; i++) {
    await t.app.inject({ method: "POST", url: "/v1/projects", headers: acct.auth, payload: { name: `p${i}` } });
  }
});
afterAll(async () => {
  await t.close();
});

interface PageBody {
  items: { name: string }[];
  nextCursor: string | null;
}
async function get(query: string): Promise<{ status: number; body: PageBody }> {
  const res = await t.app.inject({ method: "GET", url: `/v1/projects?${query}`, headers: acct.auth });
  return { status: res.statusCode, body: res.json<PageBody>() };
}

async function walk(limit: number): Promise<string[][]> {
  const pages: string[][] = [];
  let cursor: string | null = null;
  do {
    const { body }: { body: PageBody } = await get(`limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`);
    pages.push(body.items.map((p) => p.name));
    cursor = body.nextCursor;
  } while (cursor);
  return pages;
}

describe("cursor pagination", () => {
  it("walks every item once, newest first, with no duplicates or gaps", async () => {
    const pages = await walk(3);
    expect(pages).toEqual([["p7", "p6", "p5"], ["p4", "p3", "p2"], ["p1"]]);
  });

  it("an exact multiple of the limit ends with a null cursor, not an empty extra page", async () => {
    expect(await walk(7)).toEqual([["p7", "p6", "p5", "p4", "p3", "p2", "p1"]]);
    expect((await walk(1)).length).toBe(7);
  });

  it("a limit larger than the data returns everything and no cursor", async () => {
    const { body } = await get("limit=100");
    expect(body.items).toHaveLength(7);
    expect(body.nextCursor).toBeNull();
  });

  it("new rows after the first page do not shift or repeat later pages", async () => {
    const first = await get("limit=3");
    await t.app.inject({ method: "POST", url: "/v1/projects", headers: acct.auth, payload: { name: "late" } });
    const second = await get(`limit=3&cursor=${first.body.nextCursor}`);
    expect(second.body.items.map((p) => p.name)).toEqual(["p4", "p3", "p2"]);
  });

  it("rejects limit 0, limit 101 and a malformed cursor with 400", async () => {
    expect((await get("limit=0")).status).toBe(400);
    expect((await get("limit=101")).status).toBe(400);
    expect((await get("limit=abc")).status).toBe(400);
    const bad = await t.app.inject({ method: "GET", url: "/v1/projects?cursor=garbage", headers: acct.auth });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("invalid_cursor");
  });

  it("an empty tenant gets an empty page", async () => {
    const other = await signup(t.app);
    const res = await t.app.inject({ method: "GET", url: "/v1/projects", headers: other.auth });
    expect(res.json()).toEqual({ items: [], nextCursor: null });
  });
});
