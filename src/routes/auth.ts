import { hashPassword, verifyPassword } from "../auth/password.js";
import { signToken } from "../auth/token.js";
import { HttpError, unauthorized } from "../http/errors.js";
import type { Deps, Registrar } from "../http/route.js";
import { createAccount, findUserByEmail, getProfile } from "../repo/accounts.js";
import { loginBody, meResponse, signupBody, tokenResponse } from "../schemas.js";

// Verified against when the email is unknown, so a miss costs the same time as a wrong password.
let decoy: Promise<string> | undefined;

export function authRoutes(r: Registrar, { cfg, pool }: Deps): void {
  const issue = (userId: string, tenantId: string) => ({
    token: signToken({ userId, tenantId }, cfg.JWT_SECRET, cfg.TOKEN_TTL_SECONDS),
    expiresInSeconds: cfg.TOKEN_TTL_SECONDS,
  });

  r.route({
    method: "post",
    path: "/v1/auth/signup",
    tag: "auth",
    summary: "Create a tenant and its first user.",
    auth: false,
    body: signupBody,
    rateLimit: cfg.AUTH_RATE_LIMIT_MAX,
    success: { status: 201, schema: tokenResponse },
    handler: async ({ body }) => {
      const passwordHash = await hashPassword(body.password, cfg.SCRYPT_COST_LOG2);
      const { userId, tenantId } = await createAccount(pool, { tenantName: body.tenantName, email: body.email, passwordHash });
      return { status: 201, body: issue(userId, tenantId) };
    },
  });

  r.route({
    method: "post",
    path: "/v1/auth/login",
    tag: "auth",
    summary: "Exchange email and password for a bearer token.",
    auth: false,
    body: loginBody,
    rateLimit: cfg.AUTH_RATE_LIMIT_MAX,
    success: { status: 200, schema: tokenResponse },
    handler: async ({ body }) => {
      const user = await findUserByEmail(pool, body.email);
      decoy ??= hashPassword("decoy", cfg.SCRYPT_COST_LOG2);
      const ok = await verifyPassword(body.password, user?.password_hash ?? (await decoy));
      if (!user || !ok) throw new HttpError(401, "invalid_credentials", "Email or password is wrong.");
      return { status: 200, body: issue(user.id, user.tenant_id) };
    },
  });

  r.route({
    method: "get",
    path: "/v1/me",
    tag: "auth",
    summary: "The signed-in user and tenant.",
    auth: true,
    success: { status: 200, schema: meResponse },
    handler: async ({ auth }) => {
      const p = await getProfile(pool, auth.userId, auth.tenantId);
      if (!p) throw unauthorized("The account behind this token no longer exists.");
      return { status: 200, body: { userId: p.id, email: p.email, tenantId: p.tenant_id, tenantName: p.tenant_name } };
    },
  });
}
