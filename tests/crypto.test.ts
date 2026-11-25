import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password.js";
import { signToken, verifyToken } from "../src/auth/token.js";

const secret = "a-secret-that-is-long-enough-for-hs256";
const who = { userId: "0b1f4a9e-5f0e-4b8e-9d54-0e8d6f1c2a33", tenantId: "7c2d9f10-1a2b-4c3d-8e4f-5a6b7c8d9e0f" };
const NOW = 1_800_000_000_000;

describe("password hashing", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const stored = await hashPassword("correct horse battery", 10);
    expect(stored).toMatch(/^scrypt\$10\$8\$1\$/);
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterz", stored)).toBe(false);
  });

  it("salts: the same password hashes differently", async () => {
    expect(await hashPassword("same", 10)).not.toBe(await hashPassword("same", 10));
  });

  it("rejects malformed stored values instead of throwing", async () => {
    expect(await verifyPassword("x", "plaintext")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$1$2$3$4$5")).toBe(false);
  });
});

describe("tokens", () => {
  it("round-trips claims", () => {
    const claims = verifyToken(signToken(who, secret, 60, NOW), secret, NOW + 1000);
    expect(claims).toMatchObject({ sub: who.userId, tid: who.tenantId, exp: NOW / 1000 + 60 });
  });

  it("rejects an expired token", () => {
    const token = signToken(who, secret, 60, NOW);
    expect(verifyToken(token, secret, NOW + 59_000)).not.toBeNull();
    expect(verifyToken(token, secret, NOW + 60_000)).toBeNull();
    expect(verifyToken(token, secret, NOW + 3_600_000)).toBeNull();
  });

  it("rejects a token signed with another secret", () => {
    expect(verifyToken(signToken(who, "another-secret-another-secret-0000", 60, NOW), secret, NOW)).toBeNull();
  });

  it("rejects a tampered payload", () => {
    const [h, , s] = signToken(who, secret, 60, NOW).split(".") as [string, string, string];
    const forged = Buffer.from(JSON.stringify({ sub: who.userId, tid: "11111111-1111-4111-8111-111111111111", iat: NOW / 1000, exp: NOW / 1000 + 60 })).toString("base64url");
    expect(verifyToken(`${h}.${forged}.${s}`, secret, NOW)).toBeNull();
  });

  it("rejects alg none and other algorithms", () => {
    const body = Buffer.from(JSON.stringify({ sub: who.userId, tid: who.tenantId, iat: 1, exp: 9_999_999_999 })).toString("base64url");
    const none = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    expect(verifyToken(`${none}.${body}.`, secret, NOW)).toBeNull();
    const hs512 = Buffer.from(JSON.stringify({ alg: "HS512", typ: "JWT" })).toString("base64url");
    const sig = createHmac("sha512", secret).update(`${hs512}.${body}`).digest("base64url");
    expect(verifyToken(`${hs512}.${body}.${sig}`, secret, NOW)).toBeNull();
  });

  it("rejects garbage", () => {
    for (const t of ["", "a.b", "a.b.c.d", "....", "not a token"]) expect(verifyToken(t, secret, NOW)).toBeNull();
  });
});
