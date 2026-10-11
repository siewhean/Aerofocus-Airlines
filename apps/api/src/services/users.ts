import { DEFAULT_BREAK_SCHEDULE } from "@aerofocus/core";
import { eq } from "drizzle-orm";
import type { AppDeps } from "../context";
import { userSettings, users, type NotificationPreferences } from "../db/schema";
import { ApiError } from "../errors";

export const DEFAULT_NOTIFICATIONS: NotificationPreferences = {
  boardingReminder: true,
  breakEnd: true,
  landing: true,
  channel: "both",
};

export type SettingsRow = typeof userSettings.$inferSelect;

export async function getSettings(deps: AppDeps, userId: string): Promise<SettingsRow> {
  const [row] = await deps.db.select().from(userSettings).where(eq(userSettings.userId, userId)).limit(1);
  if (!row) throw new ApiError(500, "settings_missing", "User settings are missing");
  return row;
}

export async function getUser(deps: AppDeps, userId: string) {
  const [row] = await deps.db
    .select({ id: users.id, email: users.email, displayName: users.displayName, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) throw new ApiError(404, "not_found", "User not found");
  return row;
}

export function settingsView(s: SettingsRow) {
  return {
    timeZone: s.timeZone,
    homeAirport: s.homeAirport,
    passportColour: s.passportColour,
    breakSchedule: s.breakSchedule,
    shareFlightsByDefault: s.shareFlightsByDefault,
    showCommunityFlights: s.showCommunityFlights,
    preferredAirlines: s.preferredAirlines,
    notifications: s.notifications,
    uiPreferences: s.uiPreferences,
  };
}

export const defaultSettings = (userId: string, timeZone: string) => ({
  userId,
  timeZone,
  breakSchedule: DEFAULT_BREAK_SCHEDULE,
  notifications: DEFAULT_NOTIFICATIONS,
});
