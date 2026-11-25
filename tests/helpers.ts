import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { loadConfig, type Config } from "../src/config.js";
import { MIGRATIONS_DIR } from "../src/db/paths.js";
import { migrate } from "../src/db/migrate.js";

export const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://app:app@localhost:54329/postgres";

/** A throwaway database, so test files can run in parallel without seeing each other. */
export async function createTestDb(): Promise<{ url: string; pool: pg.Pool; drop: () => Promise<void> }> {
  const name = `t_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Pool({ connectionString: ADMIN_URL, max: 1 });
  admin.on("error", () => {}); // test helper: connections are killed on purpose when databases are dropped
  try {
    await admin.query(`create database ${name}`);
  } catch (err) {
    await admin.end();
    throw new Error(`Cannot reach Postgres at ${ADMIN_URL}. Run "docker compose up -d --wait" or set TEST_DATABASE_URL. (${(err as Error).message})`, { cause: err });
  }
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 20 });
  pool.on("error", () => {}); // `drop database ... with (force)` kills connections that are still open
  return {
    url: url.toString(),
    pool,
    drop: async () => {
      await pool.end();
      await admin.query(`drop database ${name} with (force)`);
      await admin.end();
    },
  };
}

export function testConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    DATABASE_URL: ADMIN_URL,
    JWT_SECRET: "test-secret-test-secret-test-secret-0123",
    LOG_LEVEL: "silent",
    SCRYPT_COST_LOG2: "10",
    RATE_LIMIT_MAX: "10000",
    AUTH_RATE_LIMIT_MAX: "10000",
    ...overrides,
  });
}

export interface TestApp {
  app: FastifyInstance;
  pool: pg.Pool;
  cfg: Config;
  close: () => Promise<void>;
}

export async function startApp(overrides: Record<string, string> = {}, logStream?: Parameters<typeof buildApp>[1]): Promise<TestApp> {
  const db = await createTestDb();
  await migrate(db.pool, MIGRATIONS_DIR);
  const cfg = testConfig({ ...overrides, DATABASE_URL: db.url });
  const app = await buildApp({ cfg, pool: db.pool }, logStream);
  return {
    app,
    pool: db.pool,
    cfg,
    close: async () => {
      await app.close();
      await db.drop();
    },
  };
}

let counter = 0;

export interface Account {
  token: string;
  auth: { authorization: string };
  email: string;
}

export async function signup(app: FastifyInstance, tenantName = "Acme"): Promise<Account> {
  const email = `user${++counter}-${randomBytes(3).toString("hex")}@example.com`;
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { tenantName, email, password: "correct horse battery" },
  });
  if (res.statusCode !== 201) throw new Error(`signup failed: ${res.body}`);
  const { token } = res.json<{ token: string }>();
  return { token, auth: { authorization: `Bearer ${token}` }, email };
}

export async function createProject(app: FastifyInstance, acct: Account, name = "Project") {
  const res = await app.inject({ method: "POST", url: "/v1/projects", headers: acct.auth, payload: { name } });
  if (res.statusCode !== 201) throw new Error(`create project failed: ${res.body}`);
  return res.json<{ id: string; name: string }>();
}
