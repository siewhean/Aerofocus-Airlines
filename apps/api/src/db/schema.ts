import type {
  AttendanceSignalKind,
  BookingStatus,
  BreakSchedule,
  CabinClass,
  DepartureMode,
  FocusEventType,
  ItineraryMode,
  ItineraryStatus,
  LayoverEventType,
  ScheduleSnapshot,
  SeatAssignment,
  SessionOutcome,
} from "@aerofocus/core";
import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/** Instants are stored as epoch milliseconds (UTC), matching @aerofocus/core. */
const instant = (name: string) => bigint(name, { mode: "number" });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  createdAt: instant("created_at").notNull(),
});

/** Bearer tokens; only a SHA-256 hash of each token is stored. */
export const authTokens = pgTable(
  "auth_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: instant("created_at").notNull(),
    expiresAt: instant("expires_at").notNull(),
  },
  (t) => [index("auth_tokens_user_idx").on(t.userId)],
);

export interface NotificationPreferences {
  boardingReminder: boolean;
  breakEnd: boolean;
  landing: boolean;
  channel: "push" | "sound" | "both" | "none";
}

/** Presentation preferences the UI owns (audio, graphics, announcements). Stored opaquely. */
export type UiPreferences = Record<string, unknown>;

export const userSettings = pgTable("user_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  timeZone: text("time_zone").notNull(),
  homeAirport: text("home_airport"),
  passportColour: text("passport_colour").notNull().default("navy"),
  breakSchedule: jsonb("break_schedule").$type<BreakSchedule>().notNull(),
  shareFlightsByDefault: boolean("share_flights_by_default").notNull().default(false),
  showCommunityFlights: boolean("show_community_flights").notNull().default(true),
  preferredAirlines: jsonb("preferred_airlines").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  notifications: jsonb("notifications").$type<NotificationPreferences>().notNull(),
  uiPreferences: jsonb("ui_preferences").$type<UiPreferences>().notNull().default(sql`'{}'::jsonb`),
});

/** Immutable schedule snapshots bound to bookings (FR-007, NFR-010). */
export const scheduleSnapshots = pgTable(
  "schedule_snapshots",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    dataVersion: text("data_version").notNull(),
    operatingAirline: text("operating_airline").notNull(),
    flightNumber: text("flight_number").notNull(),
    origin: text("origin").notNull(),
    destination: text("destination").notNull(),
    operatingDate: text("operating_date").notNull(),
    departure: instant("departure").notNull(),
    arrival: instant("arrival").notNull(),
    data: jsonb("data").$type<ScheduleSnapshot>().notNull(),
  },
  (t) => [index("schedule_snapshots_service_idx").on(t.operatingAirline, t.flightNumber, t.operatingDate)],
);

/** Multi-leg itineraries (FR-041–FR-045). Each leg is a booking with itineraryId + legIndex. */
export const itineraries = pgTable(
  "itineraries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mode: text("mode").$type<ItineraryMode>().notNull(),
    /** Refreshed lazily on reads; closed statuses never change again. */
    status: text("status").$type<ItineraryStatus>().notNull().default("booked"),
    origin: text("origin").notNull(),
    destination: text("destination").notNull(),
    /** The abandoned or incomplete itinerary this one rebooks (FR-044). */
    rebookedFromId: uuid("rebooked_from_id").references((): AnyPgColumn => itineraries.id, { onDelete: "set null" }),
    /** When the user abandoned the itinerary; ends any running layover window. */
    abandonedAt: instant("abandoned_at"),
    createdAt: instant("created_at").notNull(),
  },
  (t) => [index("itineraries_user_idx").on(t.userId, t.createdAt), index("itineraries_rebooked_from_idx").on(t.rebookedFromId)],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => scheduleSnapshots.id),
    mode: text("mode").$type<DepartureMode>().notNull(),
    cabin: text("cabin").$type<CabinClass>().notNull(),
    seat: jsonb("seat").$type<SeatAssignment>().notNull(),
    plannedDeparture: instant("planned_departure").notNull(),
    plannedArrival: instant("planned_arrival").notNull(),
    studyWindowStart: instant("study_window_start"),
    studyWindowEnd: instant("study_window_end"),
    studyGoal: text("study_goal"),
    breakSchedule: jsonb("break_schedule").$type<BreakSchedule>().notNull(),
    isRandomDraw: boolean("is_random_draw").notNull().default(false),
    /** Community Flight key (flight number + operating date); null for individual flights. */
    communityKey: text("community_key"),
    status: text("status").$type<BookingStatus>().notNull().default("booked"),
    /**
     * Itinerary leg (Phase 3); null for single bookings. Deleting an itinerary keeps its bookings
     * (and their flight sessions and rewards) as single bookings.
     */
    itineraryId: uuid("itinerary_id").references(() => itineraries.id, { onDelete: "set null" }),
    legIndex: integer("leg_index"),
    /**
     * Final credited focus of the layover at this leg's destination (FR-043), set once the layover
     * window has ended; null until then and for final legs and single bookings.
     */
    layoverFocusMs: bigint("layover_focus_ms", { mode: "number" }),
    createdAt: instant("created_at").notNull(),
  },
  (t) => [
    index("bookings_user_idx").on(t.userId, t.plannedDeparture),
    index("bookings_community_idx").on(t.communityKey),
    uniqueIndex("bookings_itinerary_leg_uq").on(t.itineraryId, t.legIndex),
  ],
);

/** Layover focus events (FR-043): legIndex is the leg that landed at the layover airport. */
export const layoverEvents = pgTable(
  "layover_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    itineraryId: uuid("itinerary_id")
      .notNull()
      .references(() => itineraries.id, { onDelete: "cascade" }),
    legIndex: integer("leg_index").notNull(),
    type: text("type").$type<LayoverEventType>().notNull(),
    at: instant("at").notNull(),
  },
  (t) => [index("layover_events_itinerary_idx").on(t.itineraryId, t.legIndex, t.at)],
);

export const flightSessions = pgTable(
  "flight_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Anonymous, session-specific public identifier (FR-060). */
    publicId: uuid("public_id").notNull().defaultRandom(),
    boardedAt: instant("boarded_at").notNull(),
    departure: instant("departure").notNull(),
    arrival: instant("arrival").notNull(),
    focusStart: instant("focus_start").notNull(),
    isPublic: boolean("is_public").notNull().default(false),
    exitedAt: instant("exited_at"),
    validatedAt: instant("validated_at"),
    confirmedUnattendedStarts: jsonb("confirmed_unattended_starts").$type<number[]>().notNull().default(sql`'[]'::jsonb`),
    goalCompleted: boolean("goal_completed"),
    /** Set once the outcome is final; finalisation is idempotent (NFR-007). */
    outcome: text("outcome").$type<SessionOutcome>(),
    creditedFocusMs: bigint("credited_focus_ms", { mode: "number" }),
    breakMs: bigint("break_ms", { mode: "number" }),
    creditedFlightMs: bigint("credited_flight_ms", { mode: "number" }),
    finalizedAt: instant("finalized_at"),
  },
  (t) => [
    uniqueIndex("flight_sessions_booking_uq").on(t.bookingId),
    index("flight_sessions_user_idx").on(t.userId, t.departure),
    index("flight_sessions_open_idx").on(t.finalizedAt, t.arrival),
  ],
);

export const focusEvents = pgTable(
  "focus_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => flightSessions.id, { onDelete: "cascade" }),
    type: text("type").$type<FocusEventType>().notNull(),
    at: instant("at").notNull(),
  },
  (t) => [index("focus_events_session_idx").on(t.sessionId, t.at)],
);

export const attendanceSignals = pgTable(
  "attendance_signals",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => flightSessions.id, { onDelete: "cascade" }),
    kind: text("kind").$type<AttendanceSignalKind>().notNull(),
    at: instant("at").notNull(),
  },
  (t) => [index("attendance_signals_session_idx").on(t.sessionId, t.at)],
);

export const travelMarks = pgTable(
  "travel_marks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** null for marks imported from guest history. */
    sessionId: uuid("session_id").references(() => flightSessions.id, { onDelete: "set null" }),
    country: text("country").notNull(),
    airport: text("airport").notNull(),
    flightNumber: text("flight_number").notNull(),
    airline: text("airline").notNull(),
    aircraftType: text("aircraft_type"),
    arrivalDate: text("arrival_date").notNull(),
    designId: text("design_id").notNull(),
    /** Intermediate (layover) airport of an itinerary (FR-048, FR-049). */
    isTransit: boolean("is_transit").notNull().default(false),
    /** How many times the user had then reached this country, transit and final together (FR-050). */
    visitNumber: integer("visit_number").notNull().default(1),
    createdAt: instant("created_at").notNull(),
  },
  (t) => [uniqueIndex("travel_marks_session_uq").on(t.sessionId), index("travel_marks_user_idx").on(t.userId)],
);

/** Finalised history imported from guest mode (FR-071). */
export const importedFlights = pgTable(
  "imported_flights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => scheduleSnapshots.id),
    outcome: text("outcome").$type<SessionOutcome | "no_show">().notNull(),
    departure: instant("departure").notNull(),
    arrival: instant("arrival").notNull(),
    creditedFocusMs: bigint("credited_focus_ms", { mode: "number" }).notNull(),
    breakMs: bigint("break_ms", { mode: "number" }).notNull(),
    creditedFlightMs: bigint("credited_flight_ms", { mode: "number" }).notNull(),
    studyGoal: text("study_goal"),
    goalCompleted: boolean("goal_completed"),
    importedAt: instant("imported_at").notNull(),
  },
  (t) => [uniqueIndex("imported_flights_user_departure_uq").on(t.userId, t.departure)],
);

export const achievements = pgTable(
  "achievements",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    achievementId: text("achievement_id").notNull(),
    earnedAt: instant("earned_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.achievementId] })],
);

