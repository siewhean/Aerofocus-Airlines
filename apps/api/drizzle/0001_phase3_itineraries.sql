CREATE TABLE "itineraries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"rebooked_from_id" uuid,
	"abandoned_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "layover_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"itinerary_id" uuid NOT NULL,
	"leg_index" integer NOT NULL,
	"type" text NOT NULL,
	"at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "itinerary_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "leg_index" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "layover_focus_ms" bigint;--> statement-breakpoint
ALTER TABLE "travel_marks" ADD COLUMN "is_transit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "travel_marks" ADD COLUMN "visit_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "itineraries" ADD CONSTRAINT "itineraries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itineraries" ADD CONSTRAINT "itineraries_rebooked_from_id_itineraries_id_fk" FOREIGN KEY ("rebooked_from_id") REFERENCES "public"."itineraries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "layover_events" ADD CONSTRAINT "layover_events_itinerary_id_itineraries_id_fk" FOREIGN KEY ("itinerary_id") REFERENCES "public"."itineraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "itineraries_user_idx" ON "itineraries" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "itineraries_rebooked_from_idx" ON "itineraries" USING btree ("rebooked_from_id");--> statement-breakpoint
CREATE INDEX "layover_events_itinerary_idx" ON "layover_events" USING btree ("itinerary_id","leg_index","at");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_itinerary_id_itineraries_id_fk" FOREIGN KEY ("itinerary_id") REFERENCES "public"."itineraries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_itinerary_leg_uq" ON "bookings" USING btree ("itinerary_id","leg_index");