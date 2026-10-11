# Aerofocus Airlines — Phase 2 UI/UX plan

Scope: the web UI only (`apps/web`). Backend packages (`packages/*`, `apps/api`) are not modified;
where the client library is narrower than the server, the UI widens types locally.

Each phase is self-contained and can run in a fresh session. Every phase cites the documents and
source lines it copies from. Verification is `pnpm typecheck`, `pnpm test`, and a browser check.

---

## Phase 0 — Documentation discovery (done)

### Sources read

- `plan.md` v4.1 (full PRD). UI-relevant sections: §3 user journey, §4–§8 booking/boarding/flight/
  route/window, §13–§16 passport/history/community/rewards, §17 guests, §19 information
  architecture and navigation, §20 visual direction, NFR-003 accessibility, §24 acceptance criteria.
- `docs/API.md` (UI integration guide; the rules table and "How the UI should drive a flight").
- `packages/client/src/api.ts:31-247`, `clock.ts`, `attendance.ts`, `guest.ts`.
- `packages/core/src/{simulation,route,geometry,lighting,timeline,clustering,route-facts,seats,
  phases,solar,community,time}.ts`, `packages/geo/src/{world,scenery}.ts`, `packages/data/src/seat-maps.ts`.
- `apps/api/src/routes/{flights,sessions,me,community,reference}.ts` for response shapes.

### Allowed APIs (exact names; nothing else exists)

**`@aerofocus/client`** (`packages/client/src/api.ts`)

| Method | Line | Notes |
|---|---|---|
| `new ApiClient({ baseUrl, token?, fetch? })` | 151 | `token` is a public mutable field; no `setToken` |
| `time()`, `airports()`, `airlines()`, `aircraft()`, `levels()`, `rules()` | 182–187 | `rules()` is `Record<string, unknown>`; keys at `reference.ts:39-52` |
| `register({email,password,displayName?,timeZone})`, `login({email,password})`, `logout()` | 190–202 | prototype methods: bind before passing |
| `me()`, `updateSettings(patch)`, `progression()`, `stats()`, `history(limit)`, `passport()`, `achievements()`, `importGuest(records)` | 204–212 | `achievements()` is `/v1/me/achievements` |
| `search(params)`, `randomFlight(studyMinutes, timeZone?)`, `flightPlan(snapshotId, departure?)` | 216–220 | `flightPlan` typed `{snapshot, plan}`; server also returns `geometry, timeline, daylightEvents, facts, seatMap` (`flights.ts:103-111`) |
| `book(input)`, `bookings()`, `booking(id)`, `cancelBooking(id)`, `board(id)` | 223–227 | `board` returns `{ sessionId }` only |
| `activeSession()`, `session(id)`, `heartbeat(id, kind)`, `startBreak`, `endBreak`, `imBack`, `exitFlight`, `validate(id, {confirmUnattendedStarts?, goalCompleted?})`, `setVisibility(id, isPublic)`, `sessionRoute(id)`, `inspect(id, {offsetMs|fraction|lat+lon})` | 230–241 | `sessionRoute` typed `{plan}`; server also returns `geometry, timeline, daylightEvents` (`sessions.ts:151-156`) |
| `communityFlights()`, `communityFlight(key)`, `guestPresence(key, presenceId, leaving?)` | 245–247 | |
| `request<T>(method, path, body?, query?)` | 157 | public; use for endpoints without a wrapper |

Endpoints with **no wrapper** (use `api.request`): `GET /v1/sessions/:id/scenery` (`sessions.ts:163`),
`GET /v1/flights/:snapshotId/inspect?departure&offsetMs|fraction&timeZone` (`flights.ts:115`),
`GET /v1/me/globe?airline&country&from&to` → GeoJSON FeatureCollection (`me.ts:150-216`),
`GET /v1/community/flights?zoom&bbox` → `{ items: ClusterResult[], total }` (`community.ts:136-149`),
`GET /v1/community/flights/public/:id` → `{ flight, position, path, serverTime }` (`community.ts:153-174`),
`GET /v1/achievements` (catalogue, guests).

**`ServerClock`** (`clock.ts:10-30`): `new ServerClock(async () => (await api.time()).now)`, `sync()`, `now()`.

**`AttendanceReporter`** (`attendance.ts:3-47`): `{ send, platform, reopened?, intervalMs?, document? }`,
`start()`, `stop()`. **Gotcha:** pass `document: document` or mobile `background`/`resume` never fire.

**`GuestStore`** (`guest.ts:69-228`): `load()`, `expiresAt()`, `clear()`, `stats(tz)`, `unlocks()`,
`book({snapshot, mode, cabin, timeZone, chosenDeparture?, studyWindow?, studyGoal?, breakSchedule?,
isRandomDraw?, airlineTier})`, `board()`, `act(action)`, `plan()`, `view()`, `finalizeIfDone()`,
`exportForImport()`. Actions: `signal|break_start|break_end|back|exit|validate|set_visibility`
(`core/session.ts:34-41`). `book()` needs a `ScheduleSnapshot` from `api.flightPlan()`, not an `Offer`.

**`@aerofocus/core`** (pure, cheap per frame unless noted)

- `flightStateAt(plan, now)` → `FlightState` (`simulation.ts:76`). Countdown source.
- `inspectAtOffset / inspectAtDistanceFraction / inspectNearestPoint (plan, x, userTimeZone)` (`simulation.ts:115-139`).
- `routeGeometry(plan, now?)` GeoJSON, MultiLineString split at ±180 (`geometry.ts:84`). Not per frame.
- `windowLightingAt(plan, now, windowSideOf(seat))` (`lighting.ts:51`, `:32`).
- `daylightEventsDuringFlight(plan)` (`lighting.ts:91`) — once per plan.
- `routeTimeline(plan, tz, {describe?})` (`timeline.ts:24`) — once per plan.
- `clusterByGrid(items, position, id, {zoom, bbox?})` (`clustering.ts:29`) — on move end only.
- `publicFlightPosition(descriptor, now)` (`community.ts:37`) — rebuilds a plan each call; cache `createFlightPlan` per descriptor and call `flightStateAt`.
- `createFlightPlan({origin, destination, departure, blockMs})` (`simulation.ts:39`).
- `daylightAt`, `sunPosition`, `daylightConditionFor` (`solar.ts`). `phaseAt(plan.phases, offsetMs)` (`phases.ts:104`).
- `displayTime`, `localParts`, `toZonedIsoString`, `MINUTE`, `HOUR` (`time.ts`).
- `seatMapFor(code, family)` (`data/seat-maps.ts:107`), `SeatMap { cabins, wingRows }`, `CabinLayout { rows, letters, windowLetters }`.
- `PASSPORT_COLOURS` (`passport.ts:72`).

**Do not import `@aerofocus/geo` in the browser bundle** (756 KB TopoJSON, synchronous
point-in-polygon). Use the API `scenery`, `route`, `plan` endpoints; for guests use core
`describeLocation` (`route.ts:81`).

### Anti-patterns (do not invent)

No `positionAt`, `sunriseAt`, `formatDuration`, `currentPhase(plan, now)`, `setToken`,
`setTimeZone`, `api.scenery()`, `guest.heartbeat()`, `guest.validate()`, cluster ids or expansion
zoom, phase display labels, prose scenery. See the extraction notes above.

---

## Design plan (frontend-design pass)

**Subject.** A productivity timer dressed as a real airline journey. Audience: students and
professionals who study 1–8 hours; aviation enthusiasts. Primary job: get someone from "I have two
hours" to seated-and-focused in under a minute, then stay out of the way.

**Concept: Ground and Air.** The app has two atmospheres and crossing the jet bridge switches them.

- *Ground* (dashboard, search, bookings, passport, settings): warm ivory, airport-signage typography,
  departure-board tables with tabular numerals, a boarding pass with a perforated stub.
- *Air* (boarding sequence, in-flight, arrival): midnight navy, the cabin window as the hero, large
  countdown, controls recede. Interface brightness is user-adjustable (FR-024).

**The one bold element:** the aircraft window. A tall rounded-rectangle porthole whose sky is driven
by `windowLightingAt` (sun elevation and side), with a wing silhouette and drifting cloud layers.
Everything else stays quiet.

**Palette** (brief-pinned directions from PRD §20, hex chosen here)

| Token | Hex | Use |
|---|---|---|
| midnight | `#0E1A2F` | Air background, boarding pass header |
| midnight-raised | `#182845` | Air surfaces |
| ivory | `#F4EFE4` | Ground background |
| ivory-raised | `#FCFAF4` | Ground surfaces, cards |
| ink | `#1B2230` | Text on ivory |
| sky | `#8FC1E3` | Route lines, positions, geographic elements |
| gold | `#C8A75A` | Premium, levels, locks, wing-view badge |
| slate | `#6E7684` | Secondary text, rules |
| signal | `#2FA874` | Boarding/on-time status, focus on |
| amber | `#E0A526` | Breaks, warnings, validation countdown |

**Typography.** One family: **Bricolage Grotesque** (variable: weight 200–800, width 75–100,
optical size 12–96). Width 85–90 at display sizes for IATA codes and the departure board (the
split-flap condensed look); width 100 for body. `font-variant-numeric: tabular-nums` everywhere a
number changes. Scale (ratio ≈1.25): 13 / 15 / 18 / 22 / 28 / 36 / 48 / 72 / 112. Body 15/1.55,
max 72ch. Sentence case; no all-caps labels; no accent-one-word headlines.

**Layout.** Desktop: 72px icon rail on the left grouped Fly / Explore / Collection / Account (PRD
§19), content left-aligned in a 1200px column, numerals right-aligned in tables. Mobile: bottom tab
bar with the same four groups. In-flight: the rail collapses into a single "exit" affordance and a
focus-mode switcher (FR-034).

```
GROUND / dashboard                         AIR / in-flight
┌──┬───────────────────────────────┐      ┌───────────────────────────────────┐
│F │ SIN  Singapore Changi  14:32   │      │            ╭────────╮              │
│E │ ───────────────────────────── │      │            │  sky   │   SQ 322      │
│C │ Departures         next 7 days │      │            │  wing  │   SIN → LHR   │
│A │ 15:10 SQ322 SIN→LHR 13h05 board│      │            ╰────────╯              │
│  │ 15:40 TR 12 SIN→BKK  2h25     │      │        07:41:12 remaining           │
│  │ ...                           │      │   ▸ cruise · 38,000 ft · Over India │
│  │ [ I have time until … ] [Random]      │   focus on · next break 16:00       │
└──┴───────────────────────────────┘      └───────────────────────────────────┘
```

**Review against generic defaults.** Cream + serif + terracotta: avoided (no serif, no warm accent;
ivory is brief-pinned). Near-black + acid green: avoided (navy is brief-pinned; signal green is a
status colour, not an accent). Card kit: tables and rules carry structure, cards only where an
object is a card (boarding pass, passport). No eyebrows, no middle-dot meta strings, no arrow
suffixes, no monospace for data (the width axis does that job). Motion: one orchestrated moment at
boarding (jet-bridge wipe from ivory to midnight) and user-triggered transitions only; all honour
`prefers-reduced-motion`.

**Copy.** Plain verbs, sentence case, same name through a flow ("Board" → "Boarded"). Errors say
what happened and what to do. Empty states invite the next action ("No flights booked. Tell us when
you can study and we'll find one.").

---

## Phase 1 — Scaffold, design system, shell, session providers

**Implement**

1. `apps/web` with Vite + React 19 + TypeScript + react-router. Extend `tsconfig.base.json`; add
   `apps/web/tsconfig.json` with `jsx: react-jsx`, `lib: DOM`. Add `web:dev` and `web:build` scripts
   to the root `package.json`. Add `apps/web` tests to `vitest.config.ts` include.
2. `src/styles/tokens.css`: palette, type scale, spacing (4px base), radii (window 48/48/32/32),
   `data-theme="ground"|"air"`, reduced-motion, focus ring. Font via `@fontsource-variable/bricolage-grotesque`.
3. Primitives in `src/ui/`: `Button`, `Field`/`Input`/`Select`, `Table` (departure-board style),
   `Badge` (locked / sample / wing view), `Dialog` (native `<dialog>`), `Toast`, `Tabs`, `Skeleton`,
   `VisuallyHidden`, `Icon` (inline SVG set: plane, window, map, globe, passport, hangar, trophy,
   community, person, settings, lock, clock, sun, moon, pause, play, exit).
4. `src/app/shell.tsx`: rail + bottom bar, `aria-current`, skip link, live clock in the user's time
   zone (FR-012) using `localParts` from core.
5. `src/lib/api.ts`: one `ApiClient` (`VITE_API_URL`, default `http://localhost:8787`), token in
   `localStorage` (`aerofocus.token`), `ServerClock` synced on boot and every 10 min.
   `src/lib/api-ext.ts`: widened types and `request` wrappers for `flightPlanFull`, `sessionRouteFull`,
   `scenery`, `previewInspect`, `globe`, `communityClusters`, `publicFlight`, `achievementCatalogue`.
6. `src/lib/session.tsx`: `SessionProvider` exposing `{ mode: "guest"|"user", api, clock, guest:
   GuestStore, user, settings, timeZone, refresh() }`. Guest `now` wired to `clock.now`. Guest
   expiry banner (FR-069).
7. `src/lib/rules.ts`: fetch `/v1/rules` once; typed accessor.
8. `src/lib/format.ts`: `formatCountdown(ms)`, `formatDuration(ms)`, `formatClock(DisplayTime)`,
   `phaseLabel(FlightPhase)`, `cabinLabel`, `modeLabel`.

**Docs to copy from:** `docs/API.md` "Rules the UI must respect"; `clock.ts:10-30`; `guest.ts:69-74`.

**Verify:** `pnpm typecheck`; `pnpm --filter @aerofocus/web dev` boots; shell renders at 400px and
1280px; keyboard reaches every rail item; `data-theme` switch changes colours.

**Guards:** no `@aerofocus/geo` import in `apps/web`; no hard-coded 7 days / 10 minutes (read rules).

---

## Phase 2 — Ground: dashboard, search, booking, bookings, boarding pass

**Implement** (PRD §3 stages 1–3, §4, FR-008)

1. **Dashboard** `/`: home airport + local clock; departures board of upcoming bookings (next 7
   days) with status (Booked / Boarding / Boarded) and a "Board" action when open; last completed
   flight; focus hours; level and next unlock (`progression()`); two entry points: "I can study
   until…" (study window) and "Random flight" (duration only). Guest banner with expiry.
2. **Search** `/fly/search`: study window form (start defaults to now, end required) → `search({studyStart, studyEnd, mode: "all"})`.
   Results as a departure board: time, flight, route, aircraft, duration, type (Community/individual),
   cabins; locked airlines shown and disabled with a lock (AC-27); `dataSource: "sample"` label.
   Filters: origin, destination, airline, cabin, duration, mode. Guests pass `timeZone`.
3. **Random** `/fly/random`: minutes input → `randomFlight()` → offer card → book with `drawToken`
   (signed-in) or guest book.
4. **Book** `/fly/book/:snapshotId?mode=&departure=`: cabin choice (locked shown), custom departure
   time picker within window, study goal, break schedule (presets from `rules.defaultBreakSchedule`),
   preview route (Phase 4 component, stub until then), confirm → `book()` or `guest.book()`.
   Map API error codes to copy (`docs/API.md` error list).
5. **My bookings** `/fly/bookings`: boarding passes; cancel; board when boarding is open (`too_early`,
   `no_show` handling).
6. **Boarding pass** `/fly/pass/:bookingId`: the designed pass (airline, flight, passenger, codes,
   times in local zone, boarding opens, aircraft, cabin, seat with wing-view badge, study duration,
   goal). Stub with perforation; print-friendly.

**Docs to copy from:** `api.ts:42-84` (Offer, BoardingPass), `docs/API.md` Search/Book/Manage
bookings, `guest.ts:128-171`.

**Verify:** book a Community and a Depart Now flight as guest and as user against the running API;
locked airline cannot be booked; typecheck.

---

## Phase 3 — Air: boarding sequence, in-flight, focus, arrival validation

**Implement** (FR-009, FR-011, FR-013a, FR-014, FR-015, FR-023–FR-025, FR-034, FR-036–FR-040)

1. **Boarding sequence** `/fly/boarding/:bookingId`: 5 captions over ~90 s (`rules.boardingSequenceMs`),
   skippable for returning users; theme wipe ivory→midnight; then `board()` and route to flight.
2. **In-flight** `/fly/active`: restore via `activeSession()` (AC-10) or `guest.view()`. Each frame:
   `flightStateAt(plan, clock.now())` for countdown, phase, altitude, progress. Poll session every
   45 s and after actions. `AttendanceReporter` with `document`, platform by `matchMedia(pointer:coarse)`,
   `reopened` on cold start.
   - **Window** component: sky gradient from `windowLightingAt` (condition, elevation, brightness,
     sun side); wing silhouette; CSS cloud layers from `scenery.clouds` (API, polled 60 s; guests use
     `daylightAt` + `describeLocation`). Labelled "Simulated view".
   - Focus panel: state, next break, break controls, "I'm back" prompt (`confirm_back`), exit with
     confirmation (FR-014 copy: only completed intervals count).
   - Focus modes (FR-034): full cabin, compact, minimal timer, ambient, route map (Phase 4).
   - Lighting controls (FR-024): reading light, cabin brightness, interface brightness, reduced
     effects; persisted in `uiPreferences` for users, `localStorage` for guests.
   - Audio (FR-037/038): Web Audio synthesized engine/vent ambience with per-channel volume and
     mute; announcements as captions always, optional `speechSynthesis`; `uiPreferences`.
   - Share my flight toggle (FR-058) on individual flights; passenger count on Community Flights.
   - Notifications: `Notification` API (opt-in) + sound for break end and landing.
3. **Arrival** `/fly/arrival/:sessionId`: validation countdown to `validationDeadline`; focus summary;
   unattended spans with confirm checkboxes; goal completed; `validate()`; outcome screen for
   `complete` (stamp reveal), `invalid`, `ended_early`.

**Docs to copy from:** `docs/API.md` "How the UI should drive a flight" 1–6; `lighting.ts:13-51`;
`sessions.ts:163-180` (scenery shape); `api.ts:86-109`.

**Verify:** flight restores after refresh with correct remaining time; break pauses focus not flight;
`confirm_back` prompt blocks resume; validation before deadline yields `complete`; reduced motion
disables cloud drift; Lighthouse accessibility ≥ 95 on the flight page.

---

## Phase 4 — Maps: route inspector, timeline, community map, personal globe

**Implement** (FR-016–FR-021, FR-055–FR-062, FR-053)

1. `src/map/canvas-map.tsx`: Canvas 2D + `d3-geo` (`geoNaturalEarth1` for flat, `geoOrthographic`
   for globe), land from `world-atlas/land-110m.json` via dynamic import. Pan/zoom/drag-rotate;
   DPR-aware; `ResizeObserver`.
2. **Route map** (in-flight + booking preview): draw `routeGeometry` completed/remaining/phase lines
   and aircraft marker (recompute geometry every 5 s, marker every frame). **Inspector**: hover/click
   → `inspectNearestPoint` locally (plan is in memory), slider + arrow keys → `inspectAtDistanceFraction`;
   panel shows place label (API `placeLabel`/timeline nearest entry), elapsed, remaining, local clock
   time, phase, progress %, lat/lon expandable. "Simulated" label. Never mutates flight state (FR-019).
3. **Timeline** (NFR-003): `routeTimeline` entries from API/plan as a `<table>` with
   `aria-describedby`; keyboard focus moves the inspector.
4. **Community** `/explore/community`: `communityClusters(zoom, bbox)` on move end; items positioned
   locally with cached plans; click → `publicFlight(id)` sheet with origin, destination, path,
   position, passenger count only (AC-32). "Show other flights" toggle (`showCommunityFlights`).
5. **Globe** `/explore/globe`: orthographic canvas with `/v1/me/globe` legs and airports; drag to
   rotate, wheel to zoom, click leg/airport for details; filters airline/country/date. Guests: built
   from `guest.load().history` with `buildGreatCircleRoute` + `splitAtAntimeridian`.

**Docs to copy from:** `geometry.ts:34-113`; `simulation.ts:115-139`; `clustering.ts:11-70`;
`community.ts:136-174`; `me.ts:150-216`.

**Verify:** AC-05/06/07 (inspect future/past, touch); 5,000 synthetic descriptors render ≥ 30 fps
in dev tools performance trace; antimeridian route (SYD→LAX style) draws without a wrap line.

---

## Phase 5 — Collection and account

**Implement** (FR-046–FR-054, FR-064–FR-066, FR-070–FR-072, §18)

1. **Passport** `/collection/passport`: cover colour (free set + custom hex, `PASSPORT_COLOURS`),
   page-turn between marks (virtual, clearly not official — FR-048), countries and airports visited,
   search.
2. **History** `/collection/history`: flight log table with status, focus, breaks, goal, mark.
3. **Stats** on Profile: `stats()` tiles and a focus-hours chart (SVG), "simulated" labels on distance.
4. **Rewards** `/collection/rewards`: levels ladder with current/next requirements, achievements grid
   with earned dates.
5. **Hangar** `/collection/hangar`: aircraft list with family, representative seat map rendering
   (`seatMapFor`, wing rows highlighted, window letters), airline unlock tiers with locks.
6. **Profile / Settings** `/account/*`: display name, time zone, home airport, passport colour,
   break defaults, audio, graphics, announcements, community privacy, notifications, account
   (sign out, export guest, delete placeholder).
7. **Auth**: sign in / create account; on guest → account, `importGuest(guest.exportForImport())`
   then `guest.clear()` with a results summary (AC-21).
8. **Membership** `/account/membership`: free tier summary and planned premium cosmetics (no payments; Phase 4 of roadmap).

**Verify:** change passport colour keeps earlier marks (AC-12); guest import shows imported/rejected;
settings round-trip through `updateSettings`.

---

## Phase 6 — Verification

1. `pnpm typecheck`, `pnpm test`, `pnpm --filter @aerofocus/web build`.
2. Greps: `grep -rn "@aerofocus/geo" apps/web/src` → none; `grep -rn "positionAt\|sunriseAt\|setToken" apps/web/src` → none; no hard-coded `7 \* DAY` / `10 \* MINUTE` rules.
3. Accessibility: keyboard-only pass through book → board → fly → validate; `prefers-reduced-motion`
   check; contrast of every token pair ≥ 4.5:1 for text.
4. Responsive at 400px, 768px, 1280px.
5. Record remaining gaps in `docs/UI-PLAN.md` "Known gaps".

---

## Status (11 October 2026)

Phases 1–5 are built in `apps/web`; `pnpm typecheck`, `pnpm test` (170 tests) and
`pnpm web:build` pass. Verified in the browser: guest search → book → boarding pass → boarding →
in-flight (cabin and map modes, route inspector) → leave early → arrival; signed-in dashboard and
bookings; community map, globe, passport, rewards, settings.

## Known gaps

- A full landing and 10-minute validation was not exercised end to end (the shortest sample flight
  is about an hour). The arrival page's `complete` branch is typed and built but unseen.
- The 5,000-aircraft community map target (AC-19) was not measured; no synthetic data source.
- Accessibility: axe-core (WCAG 2.x A/AA, 12 October 2026) reports zero violations on the dashboard,
  search results, settings, arrival, globe and hangar pages after the text tokens were darkened to
  clear 4.5:1 on ivory. The in-flight page was not audited (needs a live flight); run axe on it and
  a full keyboard walkthrough before release.
- Responsive: checked at 375px on the dashboard, search, passport and community pages; the search
  board scrolls sideways on phones by design.
- Guests cannot cancel a booking through `GuestStore` (no method); the UI edits the stored state
  directly under the `aerofocus.guest.v1` key. Add `GuestStore.cancelBooking()` in `packages/client`.
- The guest boarding pass shows a placeholder window seat before boarding; the real seat is issued
  at boarding (FR-010).
- Community Flight passenger counts are not shown on the in-flight page because the boarding pass
  carries no community key.
- Phase 3 backend (itineraries, layovers) landed while the UI was built; the UI treats every
  booking as a single leg (`itineraryId: null`). Layover Terminal and multi-leg views are not built.
- Nothing in `apps/web` is committed yet.
