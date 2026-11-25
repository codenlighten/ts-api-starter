import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { buildOpenApi } from "../http/openapi.js";
import type { Deps, Registrar } from "../http/route.js";

const ok = z.object({ status: z.literal("ok") });

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
    handler: async () => {
      if (app.lifecycle.draining) return { status: 503, body: { status: "draining" } };
      try {
        await deps.pool.query("select 1");
      } catch {
        return { status: 503, body: { status: "database_unavailable" } };
      }
      return { status: 200, body: { status: "ok" } };
    },
  });
  app.get("/openapi.json", { config: { rateLimit: false } }, () => buildOpenApi(r.specs));
}
