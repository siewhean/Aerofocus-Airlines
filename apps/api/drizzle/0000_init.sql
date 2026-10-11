CREATE TABLE "achievements" (
	"user_id" uuid NOT NULL,
	"achievement_id" text NOT NULL,
	"earned_at" bigint NOT NULL,
	CONSTRAINT "achievements_user_id_achievement_id_pk" PRIMARY KEY("user_id","achievement_id")
);
--> statement-breakpoint
CREATE TABLE "attendance_signals" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"snapshot_id" text NOT NULL,
	"mode" text NOT NULL,
	"cabin" text NOT NULL,
	"seat" jsonb NOT NULL,
	"planned_departure" bigint NOT NULL,
	"planned_arrival" bigint NOT NULL,
	"study_window_start" bigint,
	"study_window_end" bigint,
	"study_goal" text,
	"break_schedule" jsonb NOT NULL,
	"is_random_draw" boolean DEFAULT false NOT NULL,
	"community_key" text,
	"status" text DEFAULT 'booked' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flight_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"boarded_at" bigint NOT NULL,
	"departure" bigint NOT NULL,
	"arrival" bigint NOT NULL,
	"focus_start" bigint NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"exited_at" bigint,
	"validated_at" bigint,
	"confirmed_unattended_starts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"goal_completed" boolean,
	"outcome" text,
	"credited_focus_ms" bigint,
	"break_ms" bigint,
	"credited_flight_ms" bigint,
	"finalized_at" bigint
);
--> statement-breakpoint
CREATE TABLE "focus_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"type" text NOT NULL,
	"at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imported_flights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"snapshot_id" text NOT NULL,
	"outcome" text NOT NULL,
	"departure" bigint NOT NULL,
	"arrival" bigint NOT NULL,
	"credited_focus_ms" bigint NOT NULL,
	"break_ms" bigint NOT NULL,
	"credited_flight_ms" bigint NOT NULL,
	"study_goal" text,
	"goal_completed" boolean,
	"imported_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"data_version" text NOT NULL,
	"operating_airline" text NOT NULL,
	"flight_number" text NOT NULL,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"operating_date" text NOT NULL,
	"departure" bigint NOT NULL,
	"arrival" bigint NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "travel_marks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"country" text NOT NULL,
	"airport" text NOT NULL,
	"flight_number" text NOT NULL,
	"airline" text NOT NULL,
	"aircraft_type" text,
	"arrival_date" text NOT NULL,
	"design_id" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"time_zone" text NOT NULL,
	"home_airport" text,
	"passport_colour" text DEFAULT 'navy' NOT NULL,
	"break_schedule" jsonb NOT NULL,
	"share_flights_by_default" boolean DEFAULT false NOT NULL,
	"show_community_flights" boolean DEFAULT true NOT NULL,
	"preferred_airlines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notifications" jsonb NOT NULL,
	"ui_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_signals" ADD CONSTRAINT "attendance_signals_session_id_flight_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."flight_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_snapshot_id_schedule_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."schedule_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_sessions" ADD CONSTRAINT "flight_sessions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flight_sessions" ADD CONSTRAINT "flight_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_events" ADD CONSTRAINT "focus_events_session_id_flight_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."flight_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_flights" ADD CONSTRAINT "imported_flights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_flights" ADD CONSTRAINT "imported_flights_snapshot_id_schedule_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."schedule_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_marks" ADD CONSTRAINT "travel_marks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_marks" ADD CONSTRAINT "travel_marks_session_id_flight_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."flight_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_signals_session_idx" ON "attendance_signals" USING btree ("session_id","at");--> statement-breakpoint
CREATE INDEX "auth_tokens_user_idx" ON "auth_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bookings_user_idx" ON "bookings" USING btree ("user_id","planned_departure");--> statement-breakpoint
CREATE INDEX "bookings_community_idx" ON "bookings" USING btree ("community_key");--> statement-breakpoint
CREATE UNIQUE INDEX "flight_sessions_booking_uq" ON "flight_sessions" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "flight_sessions_user_idx" ON "flight_sessions" USING btree ("user_id","departure");--> statement-breakpoint
CREATE INDEX "flight_sessions_open_idx" ON "flight_sessions" USING btree ("finalized_at","arrival");--> statement-breakpoint
CREATE INDEX "focus_events_session_idx" ON "focus_events" USING btree ("session_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "imported_flights_user_departure_uq" ON "imported_flights" USING btree ("user_id","departure");--> statement-breakpoint
CREATE INDEX "schedule_snapshots_service_idx" ON "schedule_snapshots" USING btree ("operating_airline","flight_number","operating_date");--> statement-breakpoint
CREATE UNIQUE INDEX "travel_marks_session_uq" ON "travel_marks" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "travel_marks_user_idx" ON "travel_marks" USING btree ("user_id");