import { Hono } from "hono";
import { cors } from "hono/cors";
import { authenticate, type AppEnv } from "./auth";
import type { AppDeps } from "./context";
import { errorResponse } from "./errors";
import { authRoutes } from "./routes/auth";
import { bookingRoutes } from "./routes/bookings";
import { communityRoutes } from "./routes/community";
import { flightRoutes } from "./routes/flights";
import { meRoutes } from "./routes/me";
import { referenceRoutes } from "./routes/reference";
import { sessionRoutes } from "./routes/sessions";

export function createApp(deps: AppDeps) {
  const app = new Hono<AppEnv>();
  app.use("*", cors({ origin: deps.corsOrigins.includes("*") ? "*" : deps.corsOrigins, allowHeaders: ["Authorization", "Content-Type"] }));
  app.onError(errorResponse);
  app.notFound((c) => c.json({ error: { code: "not_found", message: "Route not found", details: null } }, 404));

  app.get("/health", (c) => c.json({ ok: true }));
  app.use("/v1/*", authenticate(deps));
  app.route("/v1", referenceRoutes(deps));
  app.route("/v1/auth", authRoutes(deps));
  app.route("/v1/me", meRoutes(deps));
  app.route("/v1/flights", flightRoutes(deps));
  app.route("/v1/bookings", bookingRoutes(deps));
  app.route("/v1/sessions", sessionRoutes(deps));
  app.route("/v1/community", communityRoutes(deps));
  return app;
}

export type App = ReturnType<typeof createApp>;
