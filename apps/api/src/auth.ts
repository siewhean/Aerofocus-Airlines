import { DAY } from "@aerofocus/core";
import { and, eq, gt } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import type { AppDeps } from "./context";
import { authTokens, users } from "./db/schema";
import { ApiError } from "./errors";

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))),
  );

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const TOKEN_TTL_MS = 30 * DAY;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, keyB64] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export async function issueToken(deps: AppDeps, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = deps.clock.now();
  await deps.db.insert(authTokens).values({ tokenHash: sha256(token), userId, createdAt: now, expiresAt: now + TOKEN_TTL_MS });
  return token;
}

export async function revokeToken(deps: AppDeps, token: string): Promise<void> {
  await deps.db.delete(authTokens).where(eq(authTokens.tokenHash, sha256(token)));
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  token: string;
}

export type AppEnv = { Variables: { user: AuthUser | null } };

function bearer(header: string | undefined): string | null {
  const m = header ? /^Bearer\s+(.+)$/i.exec(header) : null;
  return m?.[1]?.trim() ?? null;
}

/** Resolves the bearer token if present. Guests have no token. */
export function authenticate(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = bearer(c.req.header("authorization"));
    c.set("user", null);
    if (token) {
      const [row] = await deps.db
        .select({ id: users.id, email: users.email, displayName: users.displayName })
        .from(authTokens)
        .innerJoin(users, eq(users.id, authTokens.userId))
        .where(and(eq(authTokens.tokenHash, sha256(token)), gt(authTokens.expiresAt, deps.clock.now())))
        .limit(1);
      if (!row) throw new ApiError(401, "invalid_token", "Session expired or invalid");
      c.set("user", { ...row, token });
    }
    await next();
  };
}

export function requireUser(user: AuthUser | null): AuthUser {
  if (!user) throw new ApiError(401, "authentication_required", "Sign in to use this endpoint");
  return user;
}
