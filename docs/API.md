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

- `GET /v1/flights/:snapshotId/plan?departure=` → `{ snapshot, plan }`: route points, phase plan.
- `GET /v1/flights/:snapshotId/inspect?departure=&offsetMs=|fraction=` → `{ point }`.

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
`flight_in_progress`, `invalid_draw_token`.

### Manage bookings

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/bookings` | upcoming and boarded boarding passes ("My Bookings") |
| GET | `/v1/bookings/:id` | one boarding pass |
| DELETE | `/v1/bookings/:id` | cancel before boarding |
| POST | `/v1/bookings/:id/board` | → `{ sessionId }`. Errors `too_early`, `no_show`, `already_boarded` |

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
| GET | `/v1/sessions/:id/route` | route points and phase plan for the map |
| GET | `/v1/sessions/:id/inspect` | `?offsetMs=` or `?fraction=` (slider/keyboard) or `?lat=&lon=` (tap/click) (FR-017) |

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
6. Window lighting: use `flight.daylight` (sun at the aircraft's position, now) (FR-023).

## Progress, passport, history

| Method | Path | Returns |
|---|---|---|
| GET | `/v1/me/progression` | `{ stats, level, next (missing requirements), unlocks }` |
| GET | `/v1/me/stats` | focus hours, simulated flying hours, flights, airports, countries, virtual distance, completion rate, focus-to-break ratio, longest flight, streak, airline/aircraft usage |
| GET | `/v1/me/history?limit=` | flight log with status `complete` / `invalid` / `ended_early` / `in_flight` |
| GET | `/v1/me/passport` | `{ cover, marks[], countries[{country, visits}], airports[] }` |
| GET | `/v1/me/achievements` | catalogue with `earnedAt` |

Travel marks are virtual; never style them to look like official immigration endorsements (FR-048).
Simulated distance and flying hours are not physical travel (FR-054).

## Community 🔓

| Method | Path | Notes |
|---|---|---|
| GET | `/v1/community/flights` | `{ flights: PublicFlightDescriptor[], serverTime }` |
| GET | `/v1/community/flights/:key` | passenger count for one Community Flight |
| POST | `/v1/community/presence` | guests: `{ communityKey, presenceId (uuid), leaving? }` every minute |

A descriptor contains only `id`, `kind` (`individual` | `community`), `origin`, `destination`,
`departure`, `blockMs` and, for Community Flights, `passengerCount`. Compute positions in the
browser with `publicFlightPosition(descriptor, now)`; the server does not stream positions. Hiding
other flights is a UI setting (`showCommunityFlights`); it must not affect the user's own flight.

## Guest mode

Guests use `GuestStore` from `@aerofocus/client` with `localStorage`. It books, boards, runs the
focus timeline and validates flights on the device with the same rules as the server; nothing is
stored on the server (FR-069). Use the search and Random Flight endpoints with `?timeZone=`, and
`flightPlan()` to get the snapshot to pass to `guest.book()`.

On sign-up, call `api.importGuest(guest.exportForImport())`, then `guest.clear()`. The server
validates each record against the real schedule and rejects overlaps, future flights and
mismatched durations (AC-21).
