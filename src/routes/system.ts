import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../http/errors.js";
import { buildOpenApi } from "../http/openapi.js";
import type { Deps, Registrar } from "../http/route.js";

const ok = z.object({ status: z.literal("ok") });
const READY_TIMEOUT_MS = 2000;

/** Resolves if the work finishes in time. A database that has gone silent must not hold the probe open. */
async function within(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms);
  });
  try {
    await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

export function systemRoutes(r: Registrar, app: FastifyInstance, deps: Deps): void {
  r.route({
    method: "get",
    path: "/healthz",
    tag: "system",
    summary: "Liveness: the process is up.",
    auth: false,
    rateLimit: false,
    success: { status: 200, schema: ok },
    handler: () => Promise.resolve({ status: 200, body: { status: "ok" } }),
  });
  r.route({
    method: "get",
    path: "/readyz",
    tag: "system",
    summary: "Readiness: the database answers and the process is not shutting down.",
    auth: false,
    rateLimit: false,
    success: { status: 200, schema: ok },
    errors: { 503: "Shutting down, or the database does not answer" },
    handler: async () => {
      if (app.lifecycle.draining) throw new HttpError(503, "draining", "The process is shutting down.");
      try {
        await within(deps.pool.query("select 1"), READY_TIMEOUT_MS);
      } catch {
        throw new HttpError(503, "database_unavailable", "The database did not answer.");
      }
      return { status: 200, body: { status: "ok" } };
    },
  });
  app.get("/openapi.json", { config: { rateLimit: false } }, () => buildOpenApi(r.specs));
}
