import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { hashPassword, issueToken, requireUser, revokeToken, verifyPassword, type AppEnv } from "../auth";
import type { AppDeps } from "../context";
import { userSettings, users } from "../db/schema";
import { ApiError, parseJson } from "../errors";
import { defaultSettings, settingsView } from "../services/users";
import { timeZoneSchema } from "./common";

const registerSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(60).nullish(),
  timeZone: timeZoneSchema,
});

const loginSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(200),
});

export function authRoutes(deps: AppDeps) {
  const app = new Hono<AppEnv>();

  app.post("/register", async (c) => {
    const body = await parseJson(c, registerSchema);
    const passwordHash = await hashPassword(body.password);
    const now = deps.clock.now();
    const user = await deps.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({ email: body.email, passwordHash, displayName: body.displayName ?? null, createdAt: now })
        .onConflictDoNothing()
        .returning({ id: users.id, email: users.email, displayName: users.displayName });
      if (!created) throw new ApiError(409, "email_taken", "An account with this email already exists");
      await tx.insert(userSettings).values(defaultSettings(created.id, body.timeZone));
      return created;
    });
    const token = await issueToken(deps, user.id);
    const [settings] = await deps.db.select().from(userSettings).where(eq(userSettings.userId, user.id));
    return c.json({ token, user, settings: settings ? settingsView(settings) : null }, 201);
  });

  app.post("/login", async (c) => {
    const body = await parseJson(c, loginSchema);
    const [user] = await deps.db.select().from(users).where(eq(users.email, body.email)).limit(1);
    // Same response for unknown email and wrong password.
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      throw new ApiError(401, "invalid_credentials", "Email or password is incorrect");
    }
    const token = await issueToken(deps, user.id);
    return c.json({ token, user: { id: user.id, email: user.email, displayName: user.displayName } });
  });

  app.post("/logout", async (c) => {
    const user = requireUser(c.get("user"));
    await revokeToken(deps, user.token);
    return c.json({ ok: true });
  });

  return app;
}
