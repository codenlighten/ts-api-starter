import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// A small HS256 JWT implementation. It accepts exactly one algorithm, so
// "alg: none" and algorithm-confusion tokens are rejected by construction.
const HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");

const claimsSchema = z.object({
  sub: z.uuid(),
  tid: z.uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type Claims = z.infer<typeof claimsSchema>;

function mac(data: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(data).digest();
}

export function signToken(
  who: { userId: string; tenantId: string },
  secret: string,
  ttlSeconds: number,
  nowMs = Date.now(),
): string {
  const iat = Math.floor(nowMs / 1000);
  const claims: Claims = { sub: who.userId, tid: who.tenantId, iat, exp: iat + ttlSeconds };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${HEADER}.${body}.${mac(`${HEADER}.${body}`, secret).toString("base64url")}`;
}

export function verifyToken(token: string, secret: string, nowMs = Date.now()): Claims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];
  if (header !== HEADER) return null;
  const expected = mac(`${header}.${body}`, secret);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const claims = claimsSchema.safeParse(parsed);
  if (!claims.success) return null;
  if (claims.data.exp <= Math.floor(nowMs / 1000)) return null;
  return claims.data;
}
