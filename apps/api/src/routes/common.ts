import { isValidTimeZone, validateBreakSchedule } from "@aerofocus/core";
import type { Context } from "hono";
import { z } from "zod";
import type { AppEnv } from "../auth";
import type { AppDeps } from "../context";
import { ApiError, notFound } from "../errors";
import { getSettings } from "../services/users";

export const timeZoneSchema = z.string().refine(isValidTimeZone, "Unknown IANA time zone");

export const breakScheduleSchema = z
  .object({
    mode: z.enum(["auto", "manual"]),
    focusMinutes: z.number(),
    breakMinutes: z.number(),
    longBreakEvery: z.number().int(),
    longBreakMinutes: z.number(),
  })
  .superRefine((s, ctx) => {
    for (const message of validateBreakSchedule(s)) ctx.addIssue({ code: "custom", message });
  });

export const cabinSchema = z.enum(["economy", "premium_economy", "business", "first", "private"]);

/** The user's real-life time zone: their settings when signed in, else ?timeZone= (FR-012). */
export async function userTimeZone(c: Context<AppEnv>, deps: AppDeps): Promise<string> {
  const user = c.get("user");
  if (user) return (await getSettings(deps, user.id)).timeZone;
  const tz = c.req.query("timeZone") ?? "UTC";
  if (!isValidTimeZone(tz)) throw new ApiError(400, "invalid_time_zone", "Unknown IANA time zone");
  return tz;
}

const uuidSchema = z.string().uuid();

/** The `:id` path parameter; anything that is not a UUID cannot exist, so it is a 404 (not a 500). */
export function idParam(c: Context, what: string): string {
  const id = c.req.param("id");
  if (!uuidSchema.safeParse(id).success) throw notFound(what);
  return id as string;
}
