import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { verifyToken } from "../auth/token.js";
import type { Config } from "../config.js";
import { fingerprint } from "../idempotency.js";
import { unauthorized } from "./errors.js";

export interface Deps {
  cfg: Config;
  pool: pg.Pool;
}
export interface Auth {
  userId: string;
  tenantId: string;
}
export interface Reply {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}
export interface Ctx<P, Q, B, A> {
  params: P;
  query: Q;
  body: B;
  auth: A extends true ? Auth : undefined;
  idempotency: { key: string | undefined; fingerprint: string };
  req: FastifyRequest;
}

export interface RouteSpec<
  P extends z.ZodType = z.ZodUndefined,
  Q extends z.ZodType = z.ZodUndefined,
  B extends z.ZodType = z.ZodUndefined,
  A extends boolean = true,
> {
  method: "get" | "post" | "patch";
  path: string;
  tag: string;
  summary: string;
  auth: A;
  params?: P;
  query?: Q;
  body?: B;
  success: { status: number; schema: z.ZodType };
  /** Per-route limit per window; false switches it off (health checks). */
  rateLimit?: number | false;
  /** Accept the Idempotency-Key header (documented in OpenAPI). */
  idempotent?: boolean;
  handler: (ctx: Ctx<z.output<P>, z.output<Q>, z.output<B>, A>) => Promise<Reply>;
}

// Specs are kept in a list so the OpenAPI document is generated from the very
// same objects that serve requests and validate input.
export type AnySpec = RouteSpec<z.ZodType, z.ZodType, z.ZodType, boolean>;

const idempotencyKey = z.string().min(1).max(255).regex(/^[\x21-\x7e]+$/, "use printable ASCII without spaces");

export class Registrar {
  readonly specs: AnySpec[] = [];
  constructor(
    private readonly app: FastifyInstance,
    private readonly deps: Deps,
  ) {}

  route<P extends z.ZodType, Q extends z.ZodType, B extends z.ZodType, A extends boolean>(
    spec: RouteSpec<P, Q, B, A>,
  ): void {
    this.specs.push(spec);
    const { cfg } = this.deps;
    const config: Record<string, unknown> = {};
    if (spec.rateLimit !== undefined) {
      config.rateLimit = spec.rateLimit === false ? false : { max: spec.rateLimit, timeWindow: cfg.RATE_LIMIT_WINDOW_MS };
    }
    this.app.route({
      method: spec.method.toUpperCase(),
      url: spec.path,
      config,
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        const auth = spec.auth ? this.authenticate(req) : undefined;
        const params = (spec.params ? spec.params.parse(req.params) : undefined) as z.output<P>;
        const query = (spec.query ? spec.query.parse(req.query) : undefined) as z.output<Q>;
        const body = (spec.body ? spec.body.parse(req.body) : undefined) as z.output<B>;
        const rawKey = spec.idempotent ? req.headers["idempotency-key"] : undefined;
        const key = rawKey === undefined ? undefined : idempotencyKey.parse(rawKey);
        const out = await spec.handler({
          params,
          query,
          body,
          auth: auth as Ctx<z.output<P>, z.output<Q>, z.output<B>, A>["auth"],
          idempotency: { key, fingerprint: fingerprint(spec.method, (req.url.split("?")[0] ?? ""), body) },
          req,
        });
        for (const [name, value] of Object.entries(out.headers ?? {})) void reply.header(name, value);
        return reply.status(out.status).send(out.body);
      },
    });
  }

  private authenticate(req: FastifyRequest): Auth {
    const header = req.headers.authorization;
    const match = typeof header === "string" ? /^Bearer (\S+)$/.exec(header) : null;
    if (!match) throw unauthorized();
    const claims = verifyToken(match[1] as string, this.deps.cfg.JWT_SECRET);
    if (!claims) throw unauthorized("The token is invalid or expired. Log in again.");
    return { userId: claims.sub, tenantId: claims.tid };
  }
}
