# Aerofocus Airlines

Study or work while virtually travelling the world, one realistically timed flight at a time.
Product requirements: [plan.md](plan.md) (v4.1).

This repository contains the Phase 1, Phase 2 and Phase 3 back end and shared logic (Phase 3:
connecting flights with scheduled layovers, terminal and lounge state, layover focus,
connecting-flight notification plans, abandonment and rebooking, transit marks and repeat-visit
records, journey statistics and achievements). **The UI is not included**; it is
built separately on top of the packages and API below.

## Structure

| Path | What it is |
|---|---|
| `packages/core` | Pure, deterministic domain logic shared by server, web UI and future mobile apps: time zones, flight phases, simulation and route inspection, sun position, focus/break timeline, attendance, outcomes and validation, booking rules, seats, unlocks, Random Flight, multi-leg itineraries and layovers, passport, stats, achievements, guest import. No I/O. |
| `packages/geo` | Real-world geography for scenery: land/ocean/coast and country under the aircraft (Natural Earth 1:50m via world-atlas, public domain), place labels, simulated cloud cover. |
| `packages/data` | Reference data (airports, airlines, aircraft), the `ScheduleProvider` interface and a **sample** timetable provider, airline unlock tiers. |
| `packages/client` | Client library for the UI: typed API client, server clock sync, attendance reporter, device-only guest mode. |
| `apps/api` | HTTP API (Hono) with PostgreSQL via Drizzle ORM. Runs on embedded PGlite when no database is configured. |
| `apps/web` | Web UI (Vite + React). Design system and build plan in `docs/UI-PLAN.md`. |
| `docs/API.md` | API reference and integration guide for the UI. |

## Running

Requires Node 22+ and pnpm.

```bash
pnpm install
```

```bash
pnpm api:dev
```

```bash
pnpm web:dev
```

The API listens on `http://localhost:8787` and the UI on `http://localhost:5173` (it proxies `/v1` to
the API; set `VITE_API_URL` for a separate deployment). Without `DATABASE_URL` it uses an in-memory embedded
Postgres (PGlite), so data resets on restart. See `apps/api/.env.example` for configuration.

```bash
pnpm test
```

```bash
pnpm typecheck
```

After changing `apps/api/src/db/schema.ts`, generate a migration with `pnpm db:generate`.

## Important limitations

- **Schedules are sample data.** `SampleScheduleProvider` generates illustrative timetables marked
  `sourceStatus: "sample"`; they are not published airline schedules. A licensed provider must
  implement `ScheduleProvider` before launch (plan.md Phase 0).
- **Skytrax positions are sample values** (`rankSource: "sample"`). Replace with the licensed ranking.
- **Travel-mark designs are empty**; every arrival uses the generic virtual design until sourced
  country designs are added to `packages/data/src/travel-marks.ts`.
- Guest presence on Community Flights is held in memory, so it works for a single API instance only.
- No rate limiting yet; add it at the edge or in the API before public launch.
- Seat maps are **representative** per aircraft type (`source: "representative"`), not any
  airline's real configuration. Present them as typical layouts until verified maps are sourced.
- Scenery knows land, ocean, coast and country only. Mountains and city lights need elevation and
  population datasets that are not included yet. Clouds are simulated, never real weather.
- Guest mode is **single-flight**: connecting flights (itineraries, layovers) need an account.
- Connection rules (minimum connection 45/60 min, 24 h maximum layover, connecting-leg boarding
  window) are provisional constants; there are no per-airport minimum connection times yet. The
  connecting services in the sample timetable are illustrative.
- The server does not push notifications; the UI schedules local notifications from each
  itinerary's notification plan.
- Phase 4+ features (premium interiors, purchases, native apps, social features) are not built.
