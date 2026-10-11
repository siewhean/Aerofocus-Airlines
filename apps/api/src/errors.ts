import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

/** Error with a stable machine-readable code for the UI. */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? code);
  }
}

export const notFound = (what: string): ApiError => new ApiError(404, "not_found", `${what} not found`);

export function errorResponse(err: Error, c: Context): Response {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message, details: err.details ?? null } }, err.status);
  }
  if (err instanceof HTTPException) {
    return c.json({ error: { code: "http_error", message: err.message, details: null } }, err.status);
  }
  console.error(err);
  return c.json({ error: { code: "internal_error", message: "Something went wrong", details: null } }, 500);
}

export async function parseJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  return parseWith(schema, body);
}

export function parseQuery<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  return parseWith(schema, c.req.query());
}

function parseWith<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ApiError(400, "invalid_request", "Request validation failed", result.error.issues);
  }
  return result.data;
}
