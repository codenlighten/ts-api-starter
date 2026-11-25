import { randomUUID } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { DestinationStream } from "pino";
import { HttpError, toProblem } from "./http/errors.js";
import { Registrar, type Deps } from "./http/route.js";
import { authRoutes } from "./routes/auth.js";
import { projectRoutes } from "./routes/projects.js";
import { systemRoutes } from "./routes/system.js";

declare module "fastify" {
  interface FastifyInstance {
    lifecycle: { draining: boolean };
  }
}

const REQUEST_ID = /^[\w.-]{1,64}$/;

export async function buildApp(deps: Deps, logStream?: DestinationStream): Promise<FastifyInstance> {
  const { cfg } = deps;
  const app = Fastify({
    logger: {
      level: cfg.LOG_LEVEL,
      redact: ["req.headers.authorization", "req.headers.cookie"],
      ...(logStream ? { stream: logStream } : {}),
    },
    requestIdLogLabel: "reqId",
    // Accept a caller's id when it is short and boring, otherwise make one.
    genReqId: (req) => {
      const given = req.headers["x-request-id"];
      return typeof given === "string" && REQUEST_ID.test(given) ? given : randomUUID();
    },
    bodyLimit: 100_000,
  });
  app.decorate("lifecycle", { draining: false });

  app.addHook("onSend", (req, reply, payload, done) => {
    void reply.header("x-request-id", req.id);
    done(null, payload);
  });
  app.setErrorHandler((err, req, reply) => {
    const p = toProblem(err, req.id);
    if (p.status >= 500) req.log.error({ err }, "unhandled error");
    return reply.status(p.status).type("application/problem+json").send(p);
  });
  app.setNotFoundHandler((req, reply) => {
    const p = toProblem(new HttpError(404, "not_found", `No route for ${req.method} ${req.url.split("?")[0]}.`), req.id);
    return reply.status(404).type("application/problem+json").send(p);
  });

  await app.register(rateLimit, {
    max: cfg.RATE_LIMIT_MAX,
    timeWindow: cfg.RATE_LIMIT_WINDOW_MS,
    errorResponseBuilder: (_req, ctx) =>
      new HttpError(429, "rate_limited", `Too many requests. Retry in ${Math.ceil(ctx.ttl / 1000)} seconds.`),
  });

  const r = new Registrar(app, deps);
  authRoutes(r, deps);
  projectRoutes(r, deps);
  systemRoutes(r, app, deps);
  return app;
}
