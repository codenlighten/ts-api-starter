import { ZodError } from "zod";

export interface Problem {
  type: "about:blank";
  title: string;
  status: number;
  code: string;
  detail: string;
  requestId: string;
  errors?: { path: string; message: string }[];
}

export class HttpError extends Error {
  readonly statusCode: number;
  constructor(
    status: number,
    readonly code: string,
    detail: string,
  ) {
    super(detail);
    this.statusCode = status;
  }
}

export const notFound = (what: string) => new HttpError(404, "not_found", `${what} not found.`);
export const unauthorized = (detail = "Send a valid bearer token in the Authorization header.") =>
  new HttpError(401, "unauthorized", detail);

const TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  404: "Not Found",
  409: "Conflict",
  413: "Payload Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
};

function problem(status: number, code: string, detail: string, requestId: string): Problem {
  return { type: "about:blank", title: TITLES[status] ?? "Error", status, code, detail, requestId };
}

export function toProblem(err: unknown, requestId: string): Problem {
  if (err instanceof ZodError) {
    const p = problem(400, "validation_failed", "The request did not match the schema. See errors.", requestId);
    p.errors = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    return p;
  }
  if (err instanceof HttpError) return problem(err.statusCode, err.code, err.message, requestId);
  const e = err as { statusCode?: number; code?: string; message?: string };
  if (typeof e.statusCode === "number" && e.statusCode >= 400 && e.statusCode < 500) {
    return problem(e.statusCode, "bad_request", e.message ?? "Bad request.", requestId);
  }
  return problem(500, "internal_error", "Something went wrong. Quote the requestId when reporting it.", requestId);
}
