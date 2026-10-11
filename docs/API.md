# Aerofocus API and UI integration guide

Base URL: `http://localhost:8787` in development. All bodies are JSON. All instants are **epoch
milliseconds (UTC)**. Wherever a time is meant for display, the API also returns a `DisplayTime`:

```json
{ "epochMs": 1760227200000, "utc": "2026-10-12T00:00:00.000Z", "local": "2026-10-12T08:00:00+08:00", "timeZone": "Asia/Singapore" }
```

`local` is always in the **user's own time zone** (FR-012): their profile setting when signed in,
otherwise the `?timeZone=` query parameter (IANA name, e.g. `Asia/Singapore`).

Errors use one shape: `{ "error": { "code": "airline_locked", "message": "…", "details": … } }`.
Branch on `code`, show `message`.

Authentication: `Authorization: Bearer <token>` from register or login. Endpoints marked 🔓 also
work for guests.

The `@aerofocus/client` package wraps every endpoint (`ApiClient`), so the UI rarely needs raw fetch.

## Rules the UI must respect

| Rule | Value | Source |
|---|---|---|
| Booking window | today + 7 days | `GET /v1/rules` |
| Community Flight boarding opens | 15 min before departure; late boarding until takeoff | FR-004 |
| Custom Departure boarding | opens at the chosen time; late boarding delays departure | FR-004 |
| Boarding sequence | 90 s, plays before the flight clock starts | FR-009 |
| Heartbeat | every 60 s while a flight is open | FR-013a |
| Unattended | no heartbeat for more than 5 min (desktop), or app reopened from closed | FR-013a |
| Validation window | 10 min after landing; otherwise the flight is invalid and earns nothing | FR-015 |
| Guest data | device only; expires 2 weeks after the last flight | FR-069 |

Fetch them at runtime from `GET /v1/rules` rather than hard-coding.

Every offer, boarding pass and history item carries `dataSource`. While it is `"sample"`, show a
small "sample schedule" label: the times are not published airline schedules (FR-003).

## Reference data 🔓

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `{ ok: true }` |
| GET | `/v1/time` | `{ now }` server time. Use `ServerClock` to sync (AC-30) |
| GET | `/v1/rules` | timers, windows, default break schedule, Random Flight odds, passport colours |
| GET | `/v1/airports` | supported airports |
| GET | `/v1/airlines` | airlines with unlock `tier` (0 = budget/starter … 6 = highest-ranked) |
| GET | `/v1/aircraft` | aircraft types and families |
| GET | `/v1/aircraft/:code/seatmap` | seat map for a type (`source: "representative"` = typical layout, not an airline's) |
| GET | `/v1/levels` | progression levels and requirements |
| GET | `/v1/achievements` | achievement catalogue |

## Accounts

| Method | Path | Body / notes |
|---|---|---|
| POST | `/v1/auth/register` 🔓 | `{ email, password (8+), displayName?, timeZone }` → `{ token, user, settings }` |
| POST | `/v1/auth/login` 🔓 | `{ email, password }` → `{ token, user }` |
| POST | `/v1/auth/logout` | revokes the token |
| GET | `/v1/me` | `{ user, settings }` |
| PATCH | `/v1/me/settings` | any of: `displayName, timeZone, homeAirport, passportColour ("navy"… or "custom:#rrggbb"), breakSchedule, shareFlightsByDefault, showCommunityFlights, preferredAirlines, notifications, uiPreferences` |

`uiPreferences` is a free-form object for audio, graphics, lighting and announcement settings
the UI owns (FR-024, FR-037, FR-038). The server stores it as-is.

## Finding and booking flights

### Search 🔓 — `GET /v1/flights/search`

Query: `studyStart`, `studyEnd` (epoch ms, together), `mode` (`community` | `individual` | `all`),
`origin`, `destination`, `airline`, `aircraft`, `cabin`, `region`, `minDurationMinutes`,
`maxDurationMinutes`, `limit`, `timeZone` (guests).

Returns `{ offers: Offer[], unlocks }`. With a study window, Community Flights must depart and land
inside it; individual flights depart at the window start and must land inside it (FR-006). Each
offer has `airline.locked` and `cabins[].locked`; show locked flights but disable booking (AC-27).

### Random Flight 🔓 — `POST /v1/flights/random`

Body `{ studyMinutes }`. Returns `{ offer, cabin, drawToken }`. Everything except the duration is
random, including locked airlines and (rarely) Business or First (FR-005). Book it with the
`drawToken`; it expires after 30 minutes.

### Flight plan and preview inspection 🔓

- `GET /v1/flights/:snapshotId/plan?departure=` → `{ snapshot, plan, geometry, timeline,
  daylightEvents, facts, seatMap }` (see "Route rendering" below).
- `GET /v1/flights/:snapshotId/inspect?departure=&offsetMs=|fraction=` → `{ point }` with `placeLabel`.

### Book — `POST /v1/bookings`

```json
{ "snapshotId": "…", "mode": "community" | "depart_now" | "custom", "cabin": "economy",
  "chosenDeparture": 1760230800000, "studyWindow": { "start": …, "end": … },
  "studyGoal": "Finish chapter 3", "breakSchedule": { … }, "drawToken": "…" }
```

`chosenDeparture` is required for `custom`. Returns `{ boardingPass }` (FR-008): flight, airline,
passenger name, origin and destination, departure, arrival, boarding opening and closing times,
aircraft, cabin, issued seat (`seat.wingView`), study duration, goal.

Error codes: `outside_booking_window`, `departure_in_past`, `boarding_closed`, `cabin_not_offered`,
`cabin_locked`, `airline_locked`, `missing_chosen_departure`, `does_not_fit_study_window`,
`flight_in_progress`, `itinerary_conflict` (overlaps a booked leg of an open itinerary),
`invalid_draw_token`.

### Manage bookings

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/bookings` | upcoming and boarded boarding passes ("My Bookings") |
| GET | `/v1/bookings/:id` | one boarding pass |
| DELETE | `/v1/bookings/:id` | cancel before boarding. Itinerary legs: `itinerary_leg` (abandon the itinerary instead) |
| POST | `/v1/bookings/:id/board` | → `{ sessionId }`. Errors `too_early`, `no_show`, `already_boarded`; itinerary legs also `previous_leg_not_boarded`, `previous_leg_not_landed`, `previous_leg_failed`, `itinerary_closed`, `connection_missed` |

Boarding passes carry `itineraryId` and `legIndex` (both `null` for single bookings).

Play the boarding sequence when the user boards. For individual flights the flight clock starts
when the 90-second sequence ends; for Community Flights it starts at the published departure.

## Flying

`SessionResponse` (returned by every endpoint below):

```text
sessionId, boardingPass, serverTime
flight: status (scheduled | in_flight | arrived), phase, elapsedMs, remainingMs, timeProgress,
        distanceFraction, position {lat, lon}, altitudeFt, daylight {elevationDeg, condition},
        departure, arrival, estimated: true
focus:  state (focus | break | awaiting_return), prompt (confirm_back | validate | null),
        nextBreakAt, unattendedNow, outcome, validationDeadline, focusMs, breakMs,
        awaitingReturnMs, creditedFocusMs, creditedFlightMs, segments[], unattended[]
isPublic, studyGoal, goalCompleted
```

| Method | Path | Purpose |
|---|---|---|
| GET | `/v1/sessions/active` | the open flight, for restoring after refresh (AC-10) |
| GET | `/v1/sessions/:id` | current state |
| POST | `/v1/sessions/:id/heartbeat` | `{ kind: "beat" \| "background" \| "resume" \| "reopen" }` |
| POST | `/v1/sessions/:id/break/start` | start a manual break |
| POST | `/v1/sessions/:id/break/end` | end a manual break |
| POST | `/v1/sessions/:id/back` | "I'm back" after an automatic break (FR-040) |
| POST | `/v1/sessions/:id/exit` | leave early (FR-014) |
| POST | `/v1/sessions/:id/validate` | `{ confirmUnattendedStarts?: number[], goalCompleted?: boolean }` (FR-015) |
| PATCH | `/v1/sessions/:id/visibility` | `{ isPublic }`, individual flights only (FR-058) |
| GET | `/v1/sessions/:id/route` | `{ plan, geometry, timeline, daylightEvents }` for the map |
| GET | `/v1/sessions/:id/scenery` | what the window shows now (see "Scenery and lighting") |
| GET | `/v1/sessions/:id/inspect` | `?offsetMs=` or `?fraction=` (slider/keyboard) or `?lat=&lon=` (tap/click) (FR-017); includes `placeLabel` |

### How the UI should drive a flight

1. Do **not** count down with timers alone. Compute progress locally each frame with
   `flightStateAt(plan, serverClock.now())` from `@aerofocus/core`, using the plan from
   `/route`. Poll `GET /v1/sessions/:id` every 30–60 s, and after every action, to refresh focus state.
2. Start an `AttendanceReporter` (`platform: "desktop"` in desktop browsers, `"mobile"` on phones,
   `reopened: true` on a cold start with a flight open). It calls `/heartbeat`.
3. Show `focus.prompt`:
   - `confirm_back`: an automatic break has ended; focus does not resume until the user taps
     "I'm back" (`/back`). Notify through the user's channel.
   - `validate`: the flight has landed. Show the arrival summary, list `focus.unattended` spans
     so the user can confirm any they actually studied through, ask about the goal, then call
     `/validate` before `validationDeadline`. Notify at landing.
4. `focus.outcome` ends as `complete`, `invalid` (not validated in time: no focus, no stamp),
   or `ended_early` (only focus up to the last break counts).
5. Inspecting the route never changes the live flight (FR-019). Inspection times are in the user's
   time zone, and positions are always estimates: label them as simulated.
6. Window lighting: use `/scenery` (or `flight.daylight` for a cheap check) (FR-023).

## Route rendering (Phase 2)

`geometry` is a GeoJSON FeatureCollection. Every feature has `properties.kind`:

| kind | geometry | notes |
|---|---|---|
| `completed` / `remaining` | MultiLineString | split at the current position |
| `phase` | MultiLineString | one per airborne phase, `properties.phase` = climb, cruise, descent, approach |
| `origin` / `destination` | Point | `properties.iata` |
| `aircraft` | Point | `properties.headingDeg`, `properties.phase` (sessions only) |

Lines are already split at the antimeridian, so they can go straight into MapLibre or a globe.
All positions are estimates (`estimated: true`); label them as simulated (FR-018).

`timeline` is the text alternative to the map for screen readers and keyboard users (NFR-003):
one entry per phase change and every 30 minutes, each with `localTime` (user's time zone),
`phase`, `placeLabel` ("Near Singapore", "Over India", "Off the coast of India", "Over the
ocean") and `progressPercent`. Render it as a list or table next to the map.

`daylightEvents` lists the sunrises and sunsets the aircraft passes through, with display times.
`facts` (flight previews) says whether the route crosses the equator or the antimeridian, flies
through a sunrise, or spends 3+ hours in darkness.

## Scenery and lighting (Phase 2)

`GET /v1/sessions/:id/scenery` returns:

```text
scenery: surface (ocean | land | coast), country, placeLabel, nearAirport, altitudeBand
         (ground | low | cruise), daylight {elevationDeg, azimuthDeg, condition},
         clouds {coverage 0..1, layer: clear | scattered | broken | overcast}, simulated: true
window:  condition, sunElevationDeg, sunAzimuthDeg, headingDeg, sunRelativeBearingDeg,
         sunSide (ahead | behind | left | right | below_horizon), sunOnWindowSide,
         exteriorBrightness 0..1
seat, phase, altitudeFt
```

Poll it every minute or two; it changes slowly. Clouds are deterministic per flight, so every
passenger on a Community Flight sees the same sky. They are decorative, **not real weather**.
`exteriorBrightness` drives the outside view only; the user's reading light and cabin brightness
settings stay separate (FR-024). Offer a low-power mode that skips rendering scenery (FR-026).

## Connecting flights (Phase 3)

Multi-leg itineraries with scheduled layovers (FR-041–FR-045). Every leg is an ordinary booking and
flight session: it is boarded with `POST /v1/bookings/:id/board`, flown with the session endpoints,
and validated within 10 minutes of landing (FR-015). Legs validated before a layover keep their
focus credit, mark and rewards even if the journey later fails (FR-044).

### Rules (provisional constants in `packages/core/src/itinerary.ts`)

| Rule | Value |
|---|---|
| Legs | 1–3 (at most 2 connections), chained, no airport visited twice |
| Minimum connection | 45 min when the previous origin, layover airport and next destination are in one country; otherwise 60 min. Per-airport overrides map (empty) |
| Maximum layover | 24 h |
| Layover | next leg departure − previous leg arrival (FR-042) |
| Booking window | every leg's **planned** departure within today + 7 days |
| Connecting-leg boarding | every leg after the first boards like a Community Flight, whatever the mode: opens 15 min before planned departure, closes at takeoff (planned departure + taxi-out). After that the connection is missed (`no_show`). Boarding after planned departure but before takeoff joins in progress: the leg keeps its planned times and focus counts from boarding |
| Order | leg *i + 1* can be boarded only after leg *i* has landed (its validation may still be pending) |
| One active flight | an open itinerary (`booked`, `in_progress`) reserves its whole journey: from the first leg's planned departure (actual once boarded) to the last leg's planned arrival, layovers included. A single booking (`POST /v1/bookings`) or another itinerary overlapping that span is refused with `409 itinerary_conflict`, and a new itinerary may not overlap a booked single flight. Once the itinerary closes the reservation ends (at `abandonedAt`, else the last finalised leg's end) |

Modes:

- `community`: every leg is a Community Flight at its published time.
- `individual`: leg 1 departs now (`depart_now`) or at `chosenDeparture` (`custom`); each later leg
  is a `custom` leg departing at the previous leg's actual arrival + the published layover. When a
  leg is boarded, the planned times of later legs are recomputed and stored. A recomputed leg that
  would fall outside the booking window or overlap another flight is cancelled instead, which makes
  the itinerary `incomplete`. With `chosenDeparture`, legs fly the services operating on that date
  (FR-003), like single Custom Departures.

Random Flight draws cannot be used in itineraries; unlocks apply to every leg (FR-065).

### Statuses

`booked` → `in_progress` → `complete` | `incomplete` | `abandoned` | `cancelled`.

- `complete`: every leg's outcome is `complete` (FR-045).
- `incomplete`: a leg ended `invalid`, `ended_early` or `no_show` (missed connection). Later
  unboarded legs are cancelled.
- `abandoned`: the user abandoned (FR-044). Counts as incomplete in stats.
- Statuses are refreshed lazily on reads (like no-shows); a closed status never changes again.

### Endpoints

| Method | Path | Notes |
|---|---|---|
| GET 🔓 | `/v1/itineraries/search?origin&destination&studyStart&studyEnd&mode=community\|individual&maxConnections=1\|2&limit` | → `{ offers: ItineraryOffer[], unlocks }`. `limit` 1–100 (default 20). Guests pass `?timeZone=` (default `UTC`) |
| POST | `/v1/itineraries` | books every leg → `201 { itinerary }`. `404 not_found` when a `snapshotId` or `rebookedFromId` does not exist (or is not yours) |
| GET | `/v1/itineraries?limit&before` | → `{ itineraries: Itinerary[], nextBefore, serverTime }`, newest first. `limit` 1–100 (default 20); `before` is a `createdAt` cursor: pass the previous page's `nextBefore` (`null` on the last page) |
| GET | `/v1/itineraries/:id` | → `{ itinerary, serverTime }` |
| POST | `/v1/itineraries/:id/abandon` | → `{ itinerary, serverTime }`. Error `not_abandonable` |
| GET | `/v1/itineraries/:id/rebook?mode&maxConnections&limit` | → `{ rebookedFromId, from, to, offers, serverTime }`. Errors `not_rebookable`, `already_at_destination` |
| GET | `/v1/itineraries/:id/layover` | → `LayoverResponse` |
| POST | `/v1/itineraries/:id/layover/focus/start` | → `LayoverResponse`. Errors `outside_layover`, `already_focusing`, `flight_in_progress` |
| POST | `/v1/itineraries/:id/layover/focus/stop` | → `LayoverResponse`. Errors `outside_layover`, `not_focusing` |
| POST | `/v1/itineraries/:id/layover/heartbeat` | → `LayoverResponse`. Send every 60 s while the layover screen is open. Errors `outside_layover`, `flight_in_progress` |

Every `:id` that is not a UUID, or not one of your itineraries, is `404 not_found` (the same holds
for bookings and flight sessions).

`ItineraryOffer`:

```json
{ "mode": "community", "chosenDeparture": null,
  "legs": [{ "legIndex": 0, …Offer }, { "legIndex": 1, …Offer }],
  "layovers": [{ "afterLegIndex": 0, "airport": AirportView, "layoverMs": 6900000, "minimumConnectionMs": 3600000, "domestic": false }],
  "departure": DisplayTime, "arrival": DisplayTime, "totalMs": …, "connections": 1, "direct": false, "bookable": true }
```

Each leg is a normal `Offer` (airline and cabin lock state included) whose `departure` is the
leg's planned departure. Community offers must fit the study window at published times;
individual offers list each route once, starting now (or at `studyStart`), and must fit the window
at their chained times. Direct flights are included (`direct: true`). Offers are sorted by total
journey time, so direct flights normally come first and fill the default `limit`: clients that want
connections should raise `limit` (up to 100).

Book with the offer's legs:

```json
{ "mode": "community", "legs": [{ "snapshotId": "…", "cabin": "business" }, { "snapshotId": "…", "cabin": "economy" }],
  "chosenDeparture": null, "studyWindow": null, "studyGoal": "…", "breakSchedule": null, "rebookedFromId": null }
```

Errors (422): `no_legs`, `too_many_legs`, `not_chained`, `unknown_airport`, `airport_revisited`,
`below_minimum_connection`, `layover_too_long`, `outside_booking_window`, plus the per-leg booking
codes above (`details.errors` lists `{ legIndex, error }`); `does_not_fit_study_window`;
`rebook_route_mismatch` (a rebooking must go from the current airport to the original destination).
409: `flight_in_progress` (a boarded flight is still in the air when the journey would start),
`itinerary_conflict` (the journey overlaps another open itinerary's reserved span or a booked single
flight), `not_rebookable`, `already_rebooked` (the itinerary already has an open or complete
rebooking; abandon that one first).

`Itinerary`:

```json
{ "id": "…", "mode": "community", "status": "in_progress",
  "origin": AirportView, "destination": AirportView, "currentAirport": AirportView,
  "rebookedFromId": null, "createdAt": …, "abandonedAt": null, "canAbandon": true,
  "departure": DisplayTime, "arrival": DisplayTime,
  "legs": [{ "legIndex": 0, "bookingId": "…", "sessionId": "…", "outcome": "complete", "creditedFocusMs": …, "boardingPass": BoardingPass }],
  "layovers": [{ "afterLegIndex": 0, "airport": AirportView, "publishedLayoverMs": …, "layoverMs": …, "lounge": "premium", "creditedFocusMs": 1200000 }],
  "layover": LayoverView | null,
  "notifications": [{ "type": "boarding_open", "at": …, "legIndex": 1 }] }
```

`outcome` is the leg's session outcome (`null` before boarding). `layovers[].creditedFocusMs` is
`null` until that layover's focus credit is final. `layover` is the current layover (after the
last boarded leg, while a later leg is not boarded), else `null`.

### Abandon and rebook (FR-044)

Abandoning cancels every later leg not yet boarded. A leg in flight is not affected (exit it with
`POST /v1/sessions/:id/exit` if wanted); completed legs keep their focus, marks and rewards. It is
refused (`not_abandonable`) once the itinerary is closed or when no booked, unboarded leg remains
(e.g. only the final leg is left and it is in flight).

From an `incomplete` or `abandoned` itinerary, `GET …/rebook` searches from `currentAirport` (the
destination of the last completed leg, or the origin) to the original destination. Book an offer
with `rebookedFromId` to create a new itinerary linked to the old one. An itinerary has at most one
live rebooking (`booked`, `in_progress` or `complete`); a second is refused with `409 already_rebooked`.

### Layovers, lounge and layover focus (FR-042, FR-043)

`LayoverResponse` = `{ layover: LayoverView | null, departures[], serverTime }`. `departures` is the
layover airport's departure board for the next 12 hours from the schedule provider
(`{ snapshotId, flightNumber, airline, destination, departure, yours, dataSource }`; `yours` marks
the connecting flight).

`LayoverView`:

```json
{ "afterLegIndex": 0, "nextBookingId": "…", "airport": AirportView, "phase": "in_terminal",
  "startsAt": DisplayTime, "departsAt": DisplayTime, "layoverMs": …, "deplaningEndsAt": DisplayTime,
  "boardingOpensAt": DisplayTime, "boardingClosesAt": DisplayTime,
  "msToBoardingOpen": …, "msToBoardingClose": …, "msToDeparture": …,
  "lounge": { "access": "premium", "premium": true },
  "focus": { "focusing": false, "focusMs": …, "creditedMs": …, "final": false, "unattended": [], "window": { "start": …, "end": … } } }
```

Phases:

| Phase | Meaning |
|---|---|
| `not_started` | the arriving leg has not landed |
| `deplaning` | landed; until the arriving leg is validated or its 10-minute window closes |
| `in_terminal` | waiting for the connecting flight's boarding to open |
| `boarding_open` | the connecting flight is boarding (until takeoff) |
| `missed` | boarding closed without boarding: missed connection, itinerary incomplete |
| `departed` | the connecting flight was boarded |
| `cancelled` | the connecting flight was cancelled (abandoned or failed itinerary) |

Countdowns never go negative. **Lounge** is presentation only: `premium` when the arriving or the
departing leg is booked in business or first, otherwise `terminal`. Lounges are never locked by
progression (FR-066).

**Layover focus** is optional. Start and stop it with the focus endpoints and send heartbeats
while it runs. Only attended time inside the layover window counts (the 5-minute unattended rule
of FR-013a applies). The window runs from the arriving leg's landing until the connecting flight
is boarded, or, if it is not, until its boarding closes, the itinerary is abandoned, or the
arriving leg's validation window closes without validation. Credit becomes final when the window
ends; it is then stored once on the arriving leg's booking (`bookings.layover_focus_ms`) and added
to the user's credited focus (stats, levels, study streak, Marathon Week), separately from the
leg's own flight credit. Time is never credited twice: focus start and heartbeats are refused with
`409 flight_in_progress` while another boarded flight is not yet finalised, and layover focus that
overlaps any other flight session of the user (boarding to exit or arrival) is not credited.

### Connecting-flight notifications

The server does not push. `itinerary.notifications` is an ordered plan (`{ type, at, legIndex }`)
for the client to schedule as local notifications; re-fetch after each state change and reschedule.

| Type | When | `legIndex` |
|---|---|---|
| `leg_landed` | the leg's (actual or planned) arrival | landing leg |
| `validate_reminder` | landing + 5 min, until validated | landing leg |
| `layover_started` | landing at a layover airport | landing leg |
| `lounge_available` | landing, when the layover has premium lounge access | landing leg |
| `boarding_open` | connecting leg boarding opens | departing leg |
| `boarding_closing` | 5 min before the connecting leg's boarding closes | departing leg |
| `connection_missed` | the connecting leg's boarding closes | departing leg |
| `itinerary_complete` | the final leg is validated | final leg |

Boarding events disappear once the connecting leg is boarded. Once a leg fails (invalid, ended
early, missed), no further landing, layover or boarding events are planned. Cancelled legs get none.

### Passport, stats and history

- The arrival of every leg that lands at an intermediate airport earns a **transit** mark
  (`isTransit: true`); the final destination earns the normal arrival mark (FR-048, FR-049). Every
  mark has `visitNumber`: how many times the user had then reached that country, transit and final
  arrivals together (FR-050).
- Stats add `itinerariesCompleted`, `multiLegItinerariesCompleted`, `multiLegCompletionRate`,
  `longestCompletedItineraryLegs`, `transitAirports`, `finalDestinations`,
  `countryVisits` (`{ [country]: { transit, final } }`), `totalLayoverMs`, `longestJourneyMs`
  (door to door) and `premiumLoungeLayovers`. Layover time is virtual, not physical travel (FR-054).
- Journey achievements (`category: "journey"`): `first_connection`, `three_leg_journey`,
  `hub_hopper` (special), `smooth_operator` (special), `lounge_regular`.

## Progress, passport, history

| Method | Path | Returns |
|---|---|---|
| GET | `/v1/me/progression` | `{ stats, level, next (missing requirements), unlocks }` |
| GET | `/v1/me/stats` | focus hours, simulated flying hours, flights, airports, countries, virtual distance, completion rate, focus-to-break ratio, longest flight, streak, airline/aircraft usage, and the connecting-flight stats above |
| GET | `/v1/me/history?limit=` | flight log with status `complete` / `invalid` / `ended_early` / `in_flight`; each item has `itineraryId` and `legIndex` (`null` for single flights) |
| GET | `/v1/me/passport` | `{ cover, marks[] (with isTransit, visitNumber), countries[{country, visits, transit, final}], airports[] }` |
| GET | `/v1/me/achievements` | catalogue with `category` and `earnedAt` |
| GET | `/v1/me/globe` | GeoJSON of completed legs (`kind: "leg"`, with `itineraryId`, `legIndex`, `isTransit`) and visited airports (`kind: "airport"`, `visits`), plus `countries`. Filters: `airline`, `country` (ISO alpha-2), `from`, `to` (FR-053) |

Travel marks are virtual; never style them to look like official immigration endorsements (FR-048).
Simulated distance and flying hours are not physical travel (FR-054).

## Community 🔓

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/community/flights` | `{ flights: PublicFlightDescriptor[], serverTime }` |
| GET | `/v1/community/flights?zoom=&bbox=west,south,east,north` | clustered: `{ items, total, serverTime }`; each item is `{ type: "flight", position, flight }` or `{ type: "cluster", position, count, sampleIds }` (FR-062) |
| GET | `/v1/community/flights/public/:id` | anonymous inspection: descriptor, position and route path only (FR-056) |
| GET | `/v1/community/flights/:key` | passenger count for one Community Flight |
| POST | `/v1/community/presence` | guests: `{ communityKey, presenceId (uuid), leaving? }` every minute → `{ passengerCount, counted }` |

A descriptor contains only `id`, `kind` (`individual` | `community`), `origin`, `destination`,
`departure`, `blockMs` and, for Community Flights, `passengerCount`. Compute positions in the
browser with `publicFlightPosition(descriptor, now)`; the server does not stream positions. Hiding
other flights is a UI setting (`showCommunityFlights`); it must not affect the user's own flight.

Guest presence ids are unauthenticated, so each client may have at most 3 ids counted per
Community Flight, with caps of 5,000 ids per flight and 100,000 overall. Capacity never returns an
error: the response is always 200, and `counted: false` means this id is not being counted (it is
also `false` after `leaving`). Ids already counted keep refreshing; ids expire after 5 minutes
without a ping, freeing the client's slots. Clients are identified by the socket IP address. With
`TRUST_PROXY=true` they are identified by the `X-Forwarded-For` entry `TRUST_PROXY_HOPS` (default 1)
positions from the right, i.e. the address appended by our own proxy; entries further left are
client-controlled and ignored. Enable `TRUST_PROXY` only behind a reverse proxy that appends the
real client address, otherwise clients can choose their own identity. Addresses are normalised
(ports, brackets, case, IPv4-mapped IPv6), and IPv6 clients are limited per /64 prefix, so all
addresses in one /64 share the 3 ids.

## Guest mode

Guests use `GuestStore` from `@aerofocus/client` with `localStorage`. Guest mode is **single-flight**
in Phase 3: connecting flights (itineraries, layovers) need an account. Guests may still use
`GET /v1/itineraries/search?timeZone=` to browse connections. It books, boards, runs the
focus timeline and validates flights on the device with the same rules as the server; nothing is
stored on the server (FR-069). Use the search and Random Flight endpoints with `?timeZone=`, and
`flightPlan()` to get the snapshot to pass to `guest.book()`.

On sign-up, call `api.importGuest(guest.exportForImport())`, then `guest.clear()`. The server
validates each record against the real schedule and rejects overlaps, future flights and
mismatched durations (AC-21).
