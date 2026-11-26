import { z } from "zod";
import { problemSchema } from "../schemas.js";
import type { AnySpec } from "./route.js";

function schemaOf(s: z.ZodType, io: "input" | "output"): Record<string, unknown> {
  const json = z.toJSONSchema(s, { io, unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

function parametersOf(s: z.ZodType | undefined, where: "path" | "query"): unknown[] {
  if (!s) return [];
  const json = schemaOf(s, "input") as { properties?: Record<string, unknown>; required?: string[] };
  return Object.entries(json.properties ?? {}).map(([name, schema]) => ({
    name,
    in: where,
    required: where === "path" || (json.required ?? []).includes(name),
    schema,
  }));
}

export function buildOpenApi(specs: AnySpec[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const s of specs) {
    const url = s.path.replace(/:(\w+)/g, "{$1}");
    const parameters = [...parametersOf(s.params, "path"), ...parametersOf(s.query, "query")];
    if (s.idempotent) {
      parameters.push({
        name: "Idempotency-Key",
        in: "header",
        required: false,
        description: "Repeat the request with the same key to get the original response instead of a second create.",
        schema: { type: "string", minLength: 1, maxLength: 255 },
      });
    }
    const problem = { content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } };
    (paths[url] ??= {})[s.method] = {
      tags: [s.tag],
      summary: s.summary,
      ...(s.auth ? { security: [{ bearer: [] }] } : {}),
      parameters,
      ...(s.body ? { requestBody: { required: true, content: { "application/json": { schema: schemaOf(s.body, "input") } } } } : {}),
      responses: {
        [s.success.status]: {
          description: "Success",
          content: { "application/json": { schema: schemaOf(s.success.schema, "output") } },
        },
        "400": { description: "Validation failed", ...problem },
        ...(s.auth ? { "401": { description: "Missing, invalid or expired token", ...problem } } : {}),
        ...(s.rateLimit === false ? {} : { "429": { description: "Rate limited", ...problem } }),
        ...Object.fromEntries(Object.entries(s.errors ?? {}).map(([status, description]) => [status, { description, ...problem }])),
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "ts-api-starter", version: "0.1.0" },
    paths,
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
      schemas: { Problem: schemaOf(problemSchema, "output") },
    },
  };
}
