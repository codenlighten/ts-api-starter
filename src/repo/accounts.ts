import type pg from "pg";
import { withTx } from "../db/pool.js";
import { HttpError } from "../http/errors.js";

export interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  password_hash: string;
}

export async function createAccount(
  pool: pg.Pool,
  input: { tenantName: string; email: string; passwordHash: string },
): Promise<{ userId: string; tenantId: string }> {
  try {
    return await withTx(pool, async (tx) => {
      const t = await tx.query<{ id: string }>("insert into tenants (name) values ($1) returning id", [input.tenantName]);
      const tenantId = (t.rows[0] as { id: string }).id;
      const u = await tx.query<{ id: string }>(
        "insert into users (tenant_id, email, password_hash) values ($1, $2, $3) returning id",
        [tenantId, input.email, input.passwordHash],
      );
      return { userId: (u.rows[0] as { id: string }).id, tenantId };
    });
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      throw new HttpError(409, "email_taken", "That email is already registered. Log in instead.");
    }
    throw err;
  }
}

export async function findUserByEmail(pool: pg.Pool, email: string): Promise<UserRow | undefined> {
  const { rows } = await pool.query<UserRow>(
    "select id, tenant_id, email, password_hash from users where email = $1",
    [email],
  );
  return rows[0];
}

export async function getProfile(pool: pg.Pool, userId: string, tenantId: string) {
  const { rows } = await pool.query<{ id: string; email: string; tenant_id: string; tenant_name: string }>(
    `select u.id, u.email, u.tenant_id, t.name as tenant_name
       from users u join tenants t on t.id = u.tenant_id
      where u.id = $1 and u.tenant_id = $2`,
    [userId, tenantId],
  );
  return rows[0];
}
