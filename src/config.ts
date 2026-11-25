import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "set it to a postgres:// connection string"),
  JWT_SECRET: z.string().min(32, "must be at least 32 characters"),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  TOKEN_TTL_SECONDS: z.coerce.number().int().min(1).default(3600),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(100).default(60_000),
  SCRYPT_COST_LOG2: z.coerce.number().int().min(4).max(20).default(15),
  SHUTDOWN_DELAY_MS: z.coerce.number().int().min(0).default(2000),
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1).default(10_000),
});

export type Config = z.infer<typeof schema>;

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = schema.safeParse(env);
  if (result.success) return result.data;
  const lines = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
  throw new ConfigError(`Invalid environment:\n${lines.join("\n")}\nSee .env.example.`);
}
