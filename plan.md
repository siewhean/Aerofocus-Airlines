# AEROFOCUS AIRLINES
## Complete Product Requirements Document (PRD)
### Version 4.1 — Production-Oriented Specification

**Tagline:** Turn Focus Into a Journey.  
**Document date:** 11 October 2026  
**Product stage:** Planning and validation  
**Proposed domain:** aerofocusairlines.com  
**Business model:** Freemium subscription and optional cosmetic purchases  
**Target platforms:** Desktop web, mobile web, iOS and Android  
**Primary audience:** Students, professionals and anyone doing focused work

**Document purpose:** Consolidate all agreed product features, user experiences, functional requirements, technical considerations, commercial requirements and production-readiness criteria.

**Naming status:** Aerofocus Airlines is provisional. Commercial name clearance is required because an existing flight-themed productivity app uses AeroFocus.

---

# Version 4.1 Changes

Version 4.1 adds the product owner's decisions and fixes from the v4.0 review.

## Owner decisions

1. **Virtual journeys on real schedules.** Users are not aboard the real aircraft. Real published flights are the template for each journey. Other users see only an anonymous origin, destination, flight path and current position. (§1.3, FR-027, FR-056)
2. **Flight phases** with a default timing model. (FR-011a)
3. **Community Flights.** Scheduled departures that run at the real published time are shared focus sessions. Depart Now and Custom Departure are individual. (FR-004)
4. **Device-only guests.** Guest data is stored only on the device and expires unless the user creates an account. (FR-069, FR-071)
5. **Issued seats.** Users cannot choose a seat. Individual flights always get a window seat with a wing view. Community Flight seats are issued anywhere in the cabin. (FR-010)
6. **Default focus and arrival validation.** Focus is on from the start of the flight, and the app may run in the background. A flight not validated within 10 minutes of landing is invalid and earns no focus credit. Legs completed before a layover keep theirs. (FR-013a, FR-015)
7. **Unlocks gate only airlines and cabin classes.** Budget airlines unlock first, then full-service airlines from lower-ranked to higher-ranked. (FR-065 to FR-067)
8. **Study-window booking.** Users choose when they want to study. The boarding pass shows where they will fly and for how long. (FR-006, FR-008)
9. **User's local time.** All clock times are shown in the user's real-life time zone, not the aircraft's position or the destination. (FR-012)
10. **7-day booking window.** (FR-002, FR-004)
11. **Window daylight** follows the sun at the aircraft's position at the current time. (FR-023)
12. **Random Flight** needs only a study duration. Everything else is random, including airlines, aircraft and cabin classes the user has not unlocked. Business and First Class appear rarely. Mystery Destination is removed. (FR-005)
13. **No minors-specific product policy.** A legal compliance check is still required. (FR-072a)
14. **Skytrax World Airline Awards** set the airline unlock order. (FR-065)
15. **Early exit keeps only completed focus intervals.** Focus in progress when the user leaves is not credited, and users confirm they are back after each break. (FR-014, FR-040)
16. **Guest data expires 2 weeks** after the guest's last flight. (FR-069)

## Confirmed review defaults

- Community Flight boarding opens 15 minutes before departure. Late boarding is allowed until takeoff; after that the booking lapses as a no-show. (FR-004)
- Unattended time means the app was closed or the computer slept for more than 5 minutes. (FR-013a)
- Seat numbers need not be unique, and Community Flights have no capacity limit. (FR-010)
- The starter airline group must cover every duration range. (FR-067)
- Premium Economy unlocks at Explorer, and the top level unlocks the highest-ranked airlines. (FR-065)
- Airline and cabin-class unlocks are in Phase 1, because they gate booking.
- Flight progress uses server time, AC-16 and AC-19 have measurable targets, new criteria AC-23 to AC-35 are added, and the data model is extended. (FR-012, Sections 22 and 24)

All open questions are resolved (Section 30).

---

# 1. Executive Summary

Aerofocus Airlines is a digital productivity platform that transforms focused work into a realistic virtual passenger-flight experience.

Instead of setting an arbitrary countdown, users choose when they want to study and pick a real commercial airline service that fits. They study throughout its published flight duration.

Journeys are virtual: users are not aboard the real aircraft. Real published schedules serve as the template for each journey's route and duration.

The user experiences the journey from booking and boarding to takeoff, cruising, in-flight services, descent, landing and arrival.

The platform will include airline-specific flight schedules, aircraft cabins, geographically informed window scenery, realistic environmental lighting, shared Community Flights, optional community flight tracking, connecting flights, airport layovers and a collectible passport.

The underlying objective is to help users maintain focus through a rewarding sense of travel, exploration and accomplishment.

## 1.1 Core value proposition

**Study or work while virtually travelling the world, one realistic flight at a time.**

Aerofocus Airlines combines:

1. A reliable productivity timer.
2. Realistic airline operations and flight durations.
3. Immersive passenger cabin environments.
4. Interactive flight-path visualisation.
5. Personal travel history and rewards.
6. Optional social experiences with other virtual passengers.

## 1.2 Differentiation

The product will prioritise capabilities that go beyond conventional flight-themed Pomodoro timers:

- Published airline-specific durations rather than arbitrary journey lengths.
- Study-window booking: users choose when to study and get a real flight that fits.
- Flexible departure choices without changing flight duration.
- Shared Community Flights that depart at real published times.
- Interactive route inspection showing expected location and the user's own clock time at any point.
- Authentic connecting-flight schedules and airport layovers.
- Different aircraft and cabin-class experiences.
- Historically and geographically informed passport collectibles.
- Privacy-controlled community flight tracking.
- Progression earned through self-reported focused work.

## 1.3 Product principles

- **Realistic:** Use genuine scheduled routes, durations and aircraft information where available.
- **Immersive:** Make passengers feel they are onboard an actual flight.
- **Study-first:** Entertainment must not routinely interrupt productive work.
- **Accessible:** Core productivity functionality remains free.
- **Trust-based:** Users declare their own focus and break periods.
- **Private:** No public exposure of a user's virtual flight without explicit permission. Public views are anonymous and limited to origin, destination, flight path and current position.
- **Reliable:** Flight time, history and rewards survive ordinary technical interruptions.
- **Transparent:** Simulated locations, visuals and timing must not be misrepresented as live aircraft operations. Users are never presented as being aboard the real aircraft.
- **Local-time first:** All clock times are shown in the user's own real-life time zone.

---

# 2. Target Users

## 2.1 University and Secondary School Students

Typical activities:

- Examination preparation
- Reading textbooks
- Completing assignments
- Watching educational lectures
- Revising course materials

Desired experience: An immersive environment that makes long revision periods more appealing.

## 2.2 Professionals

Typical activities:

- Programming
- Report writing
- Research
- Planning
- Documentation
- Administrative work

Desired experience: A quiet, atmospheric companion that helps structure uninterrupted deep-work sessions.

## 2.3 Aviation Enthusiasts

Typical activities:

- Exploring aircraft
- Discovering international routes
- Collecting airline experiences
- Tracking virtual flight journeys
- Unlocking aircraft and cabin classes

Desired experience: An aviation-authentic experience that rewards their productivity.

## 2.4 Casual Productivity Users

Typical activities:

- Reading
- Personal projects
- Creative work
- Habit building

Desired experience: An enjoyable alternative to a conventional productivity timer.

---

# 3. Overall User Journey

The complete passenger journey contains the following stages.

## Stage 1 — Airport Dashboard

The user enters Aerofocus Airlines and sees a personalised airport dashboard.

Displayed information includes:

- Selected home airport
- Current local time
- Flight departure board
- Upcoming booked flights (up to 7 days ahead)
- Previously completed flight
- Total accumulated focus hours
- Frequent-flyer level
- Upcoming unlocks
- Recommended flights
- Favourite destinations
- Quick Start and Random Flight options

## Stage 2 — Flight Search and Booking

The user enters the time window they want to study, now or up to 7 days ahead. They may also choose a destination, region or airline, or request a random route.

The platform displays real airline services that fit the window: shared Community Flights that depart at their published times, and individual flights that depart when the user chooses. Each result shows the airline, aircraft, departure time, published flight duration and possible connections.

Users choose a cabin class they have unlocked and configure study breaks and an optional study objective. Seats are issued automatically.

## Stage 3 — Boarding

A virtual boarding pass is generated. It shows where the user will fly, how long they will study and when they will depart and land, in their local time.

When boarding opens, the user enters a short preflight sequence involving welcome announcements, cabin preparation and safety instructions.

## Stage 4 — In-Flight Study

The aircraft progresses through the journey in real elapsed time.

The user can:

- Study using external applications or physical materials
- View the window and cabin
- Inspect the flight route
- Monitor the countdown
- Listen to aircraft ambience
- Take scheduled breaks
- Adjust cabin lighting
- See other users' public virtual flights
- See how many passengers share their Community Flight
- Modify audio and display preferences

## Stage 5 — Layover

If the itinerary has a connection, the passenger enters a virtual airport terminal.

The layover follows the published connection timing.

The user may rest, explore the terminal interface, visit an unlocked lounge or optionally study.

## Stage 6 — Arrival

After the scheduled flight duration has elapsed, the aircraft lands.

The user validates the flight within 10 minutes of landing (FR-015). On validation, the user receives:

- Flight completion confirmation
- Recorded focus statistics
- Destination arrival collectible
- Eligible achievements
- Unlock progression
- Updated flight history

## Stage 7 — Travel Collection

Users explore their passport, historical journeys and global route network.

The next flight can depart from their selected home airport, a manually chosen airport or an airport selected by Random Flight mode.

---

# 4. Flight Search and Booking System

## FR-001 — Home Airport

Each user may select a preferred home airport.

The home airport serves as the default departure location when manually booking a flight.

Users may change their home airport through profile settings.

Supported airports must contain validated airport codes, coordinates, countries and time zones.

## FR-002 — Flight Search

Users can search by:

- Study time window (start and end) — the primary search (FR-006)
- Departure airport
- Destination airport
- Operating date, from today up to 7 days ahead
- Preferred departure time
- Departure type: Community Flight or individual
- Airline
- Aircraft
- Cabin class
- Flight duration range
- Number of connections
- Region or country

The system must support domestic and international routes.

The booking window is today plus the next 7 days. Flights outside it cannot be booked.

Only unlocked airlines and cabin classes can be booked. Flights on locked airlines appear in results, marked as locked.

## FR-003 — Airline-Specific Duration

Flight duration must come from the published scheduled gate-to-gate time of the selected flight service.

Two airlines operating the same airport pair may have different scheduled durations.

Duration may also vary by flight number, date, season and direction.

The authoritative duration is:

**Published arrival instant − published departure instant**

This calculation must account for time zones and daylight-saving changes.

Each booking binds to the published schedule of one operating date and keeps a copy of it (a schedule snapshot). For Depart Now and Custom Departure, the platform uses the selected service's schedule for the chosen departure date. If the service does not operate that day, it uses the nearest operating date within the booking window, and the boarding pass names that date.

An estimated duration based only on geographic distance must not be described as an official airline schedule.

## FR-004 — Departure Modes

Three modes will be available.

All flights run in real time. A departure is a real moment in the user's day, never a simulated date or time.

Flights can be booked up to 7 days in advance.

### A. Community Flight (Scheduled Departure)

The flight departs at the service's actual published departure time and arrives at its published arrival time.

All users booked on the same flight number and operating date share one Community Flight. It is a shared focus session: passengers depart and land together and see an anonymous count of fellow passengers.

Focus credit, breaks, validation and rewards remain individual.

The platform uses the selected service's published timetable, not real-time operational delays or cancellations.

### B. Depart Now

The user starts an individual flight immediately after a short boarding sequence.

Its published flight duration remains unchanged, and arrival is calculated from the actual departure time.

### C. Custom Departure

The user books an individual flight to depart at a start time they choose within the booking window.

The published airline flight duration remains unchanged, and arrival is calculated from the actual departure time.

### Boarding, reminders and late arrival

The boarding sequence (FR-009) plays when the user boards. The user is reminded before boarding opens, through their chosen notification channel.

**Community Flights**

- Boarding opens 15 minutes before the published departure.
- A late passenger may board until takeoff (the end of taxi-out). They join the flight in progress, and focus starts when they board.
- After takeoff, an unboarded booking lapses as a no-show. The user must book another flight.

**Custom Departure**

- Boarding opens at the chosen departure time, and the flight departs when the boarding sequence ends, as with Depart Now.
- If the user boards late, the flight departs late and lands correspondingly later.
- A booking not boarded before its planned landing time lapses as a no-show.

## FR-005 — Random Flight

The user enters only how long they want to study. Random mode then selects a genuine supported combination of everything else:

- Departure airport
- Destination airport
- Airline
- Flight number
- Aircraft
- Route
- Schedule
- Cabin class

The flight's published duration must fit the user's study duration. Random flights are individual flights.

Random departure airports are not restricted to the home airport.

Random flights may use any airline, aircraft and cabin class the service offers, including airlines and classes the user has not unlocked. Business and First Class are drawn rarely. The odds are set during tuning.

Nothing is hidden: the boarding pass, route map and announcements show the full flight as usual.

## FR-006 — Study-Window Booking

Booking starts from when the user wants to study.

The user enters a study window: a start and end time, now or up to 7 days ahead.

The platform recommends genuine flights that fit the window:

- Community Flights whose published departure and arrival both fall inside the window.
- Individual flights whose published duration fits the window. They depart at the window start, or at a later start time the user chooses that still lets the flight land inside the window.

If a user has one hour available, the platform recommends genuine flights of approximately that duration.

A long-haul route must not be compressed into a one-hour flight merely to fit a study session.

After booking, the boarding pass shows where the user will fly, how long they will study and when they will depart and land, in their local time.

## FR-007 — Schedule Validation

Flight records must contain:

- Schedule provider and data version
- Operating airline
- Marketing airline, if different
- Flight number
- Origin and destination
- Operating date
- Departure and arrival timestamps
- Block duration
- Aircraft type where known
- Available cabin classes where verifiable
- Data freshness and source status

Codeshare flights must distinguish operating and marketing carriers.

Unknown aircraft assignments must be labelled rather than invented.

Schedules must be available for every operating date in the booking window (today plus 7 days) and refreshed at least daily.

---

# 5. Boarding and Passenger Experience

## FR-008 — Virtual Boarding Pass

A boarding pass contains:

- Airline identity
- Flight number
- Passenger display name, if provided
- Departure and destination airport
- Departure and arrival time, in the user's local time zone
- Flight type: Community Flight or individual
- Aircraft
- Cabin
- Seat assignment (issued automatically)
- Boarding status and boarding opening time
- Flight duration, shown as the study duration

## FR-009 — Boarding Sequence

The preflight sequence should be short, with a proposed standard duration of approximately 60–120 seconds.

It includes:

1. Boarding confirmation
2. Welcome announcement
3. Cabin and seat introduction
4. Condensed safety instructions
5. Preparation for departure

The sequence occurs before the scheduled block-time countdown.

Returning users may reduce introductory animations and non-essential announcements.

Passengers who board a Community Flight late (FR-004) receive a shortened sequence.

## FR-010 — Seat Assignment

Seats are issued automatically at booking. Users cannot choose a seat.

On individual flights, every passenger gets a window seat with a view of the wing, in every cabin class. This applies even where the real cabin has no wing-view window.

On Community Flights, seats are issued from anywhere in the booked cabin, as on a real flight, so a wing view is not guaranteed.

Seat numbers are presentation only. They need not be unique between passengers, and Community Flights have no capacity limit.

Cabin layouts must match supported aircraft configurations wherever those details are represented as authentic. Until aircraft-specific seat maps exist, a generic seat for the aircraft family is used.

---

# 6. Flight Simulation Engine

## FR-011 — Flight Phases

The simulation progresses through:

1. Taxi-out
2. Takeoff
3. Climb
4. Cruise
5. Descent
6. Approach
7. Landing
8. Taxi-in
9. Arrival at gate

The scheduled block duration includes ground movement between gates.

The preflight boarding experience takes place before the block-time clock.

## FR-011a — Phase Timing Model

Each flight's block time is divided into phases using default durations:

| Phase | Default duration |
|---|---|
| Taxi-out | 15 min |
| Takeoff | 1 min |
| Climb | 20 min |
| Cruise | Remainder of block time |
| Descent | 25 min |
| Approach | 8 min |
| Landing | 1 min |
| Taxi-in | 7 min |

Arrival at gate is the instant block time ends.

If cruise would be shorter than 15% of block time (flights under about 90 minutes), all non-cruise phases are scaled down proportionally so that cruise is exactly 15% of block time.

Airport-specific taxi times may replace the defaults when reliable data is available.

These defaults are provisional and must be validated against real flight profiles.

## FR-012 — Time Model

Aerofocus Airlines tracks:

- Flight elapsed time
- Flight remaining time
- Scheduled or simulated arrival time
- Declared focus time
- Break time
- Layover time
- Total completed flying hours

Flight elapsed time progresses in real time.

**One real minute equals one simulated flight minute.**

All instants are stored in UTC.

All clock times shown to the user — departure, arrival, route inspection, history and passport dates — use the user's real-life local time zone, taken from their device unless set in their profile. Times are never shown in the time zone of the aircraft's simulated position or the destination.

Flight progress is calculated from server time. Changing the device clock must not move the flight.

## FR-013 — Focus and Flight Time Independence

Pausing the focus timer does not pause the aircraft.

The user may take breaks without changing arrival time.

A 90-minute flight containing 15 minutes of recorded breaks results in 75 minutes of credited focus and 90 minutes of flight duration.

## FR-013a — Default Focus and Unattended Time

Focus is on by default from the start of the flight (the start of taxi-out), or from the moment a late passenger boards.

Breaks follow the user's break schedule and pause focus credit.

The flight continues if the device sleeps, the browser closes or the connection drops.

The app may run in the background while the user works elsewhere. Time counts as attended while the app is open, whether it is in the foreground or the background.

Time is **unattended** when the app is closed or the computer sleeps:

- Where the app keeps running in the background, such as in desktop browsers, it records a heartbeat about once a minute: on the server for registered users, and on the device for guests. Any span with no heartbeat for more than 5 minutes is unattended.
- Where the operating system pauses background apps, such as on phones, the time between leaving and returning to the app counts as attended. If the app is reopened from closed rather than resumed, the gap since it was last open is unattended. Phones cannot tell a locked screen from another app in use, so a locked phone counts as attended.

The heartbeat only shows that the app is open. It does not check screen content or input (FR-031).

Unattended time is credited as focus only if the user confirms it during arrival validation (FR-015).

## FR-014 — Early Termination

If a passenger exits an unfinished flight:

- Save only completed focus intervals, up to the last recorded break. The focus interval in progress at exit is not credited. For example, a 5-hour flight with a break each hour, exited during the last hour, records 4 hours of focus.
- Save break history.
- Mark the flight incomplete.
- Do not award a successful arrival collectible.
- Do not award flight-completion achievements.
- Preserve completed earlier connecting legs.

## FR-015 — Session Recovery and Arrival Validation

Ordinary browser refreshes, device sleep or connection interruptions must not reset the flight.

The platform must recover the correct flight position and remaining time from stored timestamps.

After landing, the user has 10 minutes to validate the flight. Validation means confirming arrival, reviewing the focus summary, confirming or rejecting any unattended spans and, optionally, marking the study goal.

- **Validated within 10 minutes:** the flight is complete. The arrival collectible, completion achievements, flying hours and confirmed focus credit are awarded.
- **Not validated within 10 minutes:** the flight is invalid. No focus credit, arrival collectible, completion achievements or flying hours are awarded for that flight. Legs of the same journey that were validated before a layover keep their focus credit and rewards (FR-044).

The user is notified at landing through their chosen notification channel.

---

# 7. Interactive Flight Route and Tracking

This is a critical product feature.

## FR-016 — Flight Route Map

Every active flight offers an interactive map with:

- Departure airport
- Destination airport
- Expected route
- Current estimated aircraft position
- Completed route segment
- Remaining route segment
- Percentage travelled
- Expected arrival

The route appears on a map or globe.

## FR-017 — Flight Path Inspection

The user can inspect any point along the expected flight path.

Supported interactions:

- Desktop mouse hover
- Mouse click
- Touchscreen tap
- Touch drag
- Keyboard-controlled route position

The inspector displays:

- Estimated geographic location
- Elapsed flight duration at that location
- Remaining flight duration
- Expected clock time at that point, in the user's local time zone
- Flight phase at that point
- Flight progress percentage

Latitude and longitude may be displayed in an expanded information panel.

## FR-018 — Geographic Route Modelling

Preferred sources are validated planned routes or licensed trajectory data.

When unavailable, the platform may use approximated geographical routes.

The interface must identify estimated positions as simulated.

Route progress should account for the aircraft being on the ground, climbing, cruising and descending.

Time mapping must not assume a constant speed across the entire gate-to-gate duration. Position is mapped from time using the phase model (FR-011a): the aircraft stays at the airport during taxi, and covers ground more slowly in climb and descent than in cruise.

## FR-019 — Route Inspection Independence

Inspecting a future or previous position must not change the actual aircraft location, countdown or simulation state.

## FR-020 — Connection Route Viewing

A connecting itinerary displays each flight leg separately.

Users may inspect the route of any leg and the layover duration between legs.

## FR-021 — Route Information Quality

If the system cannot reliably identify the nearest geographical area, it should display coordinates or a broader region instead of inventing a place name.

---

# 8. Aircraft Window and Geographic Scenery

## FR-022 — Exterior Views

The window environment may include:

- Clouds
- Oceans
- Coastlines
- Mountains
- Urban areas
- Airports
- Sunrise and sunset
- Night sky
- Distant lights
- Aircraft wings and engines

The scenery reflects approximate route geography.

It is not presented as live video from the actual aircraft.

## FR-023 — Dynamic Lighting

Exterior light conditions depend on:

- Current real date and time
- Simulated geographical position
- Solar position
- Flight phase

Overnight services should realistically transition between darkness and daylight where appropriate.

Exterior daylight is calculated from the sun's position at the aircraft's simulated position at the current real time. Because every flight runs in real time, the window shows the sky as it would look at that point on the route right now.

## FR-024 — Interior Lighting

Users may configure:

- Reading lights
- Cabin ambient-light brightness
- Interface brightness
- Preferred ambient-light themes
- Reduced visual effects

Personal lighting preferences should remain separate from the externally calculated sun position.

## FR-025 — Window View Modes

Proposed views:

- Standard passenger window
- Full-screen window
- Window with flight information
- Split-screen window and route
- Minimal ambient view

## FR-026 — Graphics Performance

Provide adjustable visual-quality levels.

Low-power devices should use a lightweight alternative rather than requiring high-end 3D rendering.

---

# 9. Airline, Aircraft and Cabin Experience

## FR-027 — Real Airlines

The platform aims to represent genuine commercial airlines.

Journeys are virtual. Users are not aboard the real aircraft, and the interface must never suggest they are. Real airline names, flight numbers and published schedules are the template for each journey.

Each supported airline may have different:

- Aircraft collections
- Cabin interiors
- Boarding presentation
- Announcements
- Ambient audio
- Meal service
- Branding
- Cabin lighting

Protected brand assets require appropriate commercial rights.

## FR-028 — Aircraft Types

Possible supported aircraft families include Airbus A320, A330, A350 and A380, and Boeing 737, 777 and 787.

The exact catalogue depends on validated schedule assignments and available content rights.

Aircraft-specific details should include:

- Cabin geometry
- Window shape
- Wing position
- Engine ambience
- Seating configuration
- Relevant cabin classes

## FR-029 — Cabin Classes

The experience may support:

- Economy
- Premium Economy
- Business
- First Class
- Private aviation

Cabin differences should go beyond colour changes.

Different classes may provide distinct interiors, service presentation, sounds, lighting and seating environments.

A cabin class must not be offered on a service that does not support it.

Cabin classes above Economy require the matching unlock (FR-065), except as a rare Random Flight draw (FR-005). Where the schedule source does not confirm which classes a service offers, only Economy is offered.

## FR-030 — Private Flights

Private aviation is an unlockable experience.

Because charter journeys often lack public scheduled-service records, these must be explicitly labelled as charter simulations.

Their durations should be estimated from reasonable aircraft performance and routing assumptions, rather than fabricated airline schedules.

---

# 10. Study Productivity System

## FR-031 — Self-Reported Focus

Users declare their own focus and break activity.

The platform will not require:

- Webcam monitoring
- Screen surveillance
- Keystroke tracking
- Mandatory concentration checks
- Inspection of third-party study materials

Users may study in another application or with physical books.

The app-open heartbeat (FR-013a) is not activity monitoring.

## FR-032 — Study Goals

Before boarding, users may optionally enter a study goal.

Examples:

- Finish a chapter
- Complete a programming task
- Revise a topic
- Prepare a report

On arrival, users may mark their goal as completed or incomplete.

## FR-033 — Break Scheduling

Support both presets and custom schedules.

Settings include:

- Focus interval duration
- Break frequency
- Break duration
- Long-rest interval
- Automatic or manually confirmed break transitions
- Break audio reminders

## FR-034 — Focus Modes

Provide:

- Full cabin mode
- Compact focus mode
- Minimal timer
- Ambient audio mode
- Route-map mode

The interface must remain suitable for use alongside external applications.

## FR-035 — Interruption Handling

Users may end declared focus periods whenever necessary.

Flight time continues independently.

Early flight termination preserves valid study statistics without awarding a completed-flight reward.

---

# 11. Announcements and In-Flight Services

## FR-036 — Announcement System

Announcements cover:

- Boarding
- Safety
- Departure
- Takeoff
- Reaching cruising altitude
- Break beginning
- Refreshment service
- Break ending
- Descent
- Landing
- Arrival

## FR-037 — Audio Customisation

Provide independent volume settings for:

- Engine sound
- Cabin ventilation
- Passenger ambience
- Voice announcements
- Background music
- Notifications
- Flight sound effects

All audio must be individually mutable.

## FR-038 — Voice and Captions

Support:

- Full voice announcements
- Essential announcements
- Silent captions
- Announcement language preferences, where supported

## FR-039 — Meal and Refreshment Breaks

Breaks may be represented by themed service events.

For example:

- Short break: beverages
- Medium break: refreshments
- Long break: meal service
- Overnight journey: extended rest period

Services should reflect journey duration and cabin class.

They must not create excessive interruptions during focus periods.

## FR-040 — Break Ending

When an automatic break ends, the system informs the user through their selected notification channel.

The flight continues regardless of whether the user resumes focus immediately.

When a break ends, the user is asked whether they are back. Focus resumes when they confirm.

---

# 12. Connecting Flights and Airport Layovers

## FR-041 — Multi-Leg Itineraries

Users may book journeys containing multiple flights.

Each leg includes its own:

- Airline
- Flight number
- Aircraft
- Cabin
- Scheduled departure and arrival
- Published duration
- Focus and break records

All legs must depart within the booking window. Each leg is validated separately at its landing (FR-015).

## FR-042 — Realistic Layover Time

The layover duration is calculated from the arrival instant of the earlier flight and the departure instant of the connecting flight.

Scheduled connections must respect applicable transfer feasibility rules where reliable data is available.

## FR-043 — Layover Activities

The virtual airport may offer:

- Terminal waiting area
- Departure board
- Gate countdown
- Lounge environment
- Rest and meal break
- Optional focus session
- Boarding notification

## FR-044 — Missed or Abandoned Connections

If a user misses or abandons a connection:

- Previously completed flight legs remain saved.
- Credited focus time remains saved.
- Previously earned rewards remain valid.
- Remaining legs must be rebooked.
- The original itinerary is marked incomplete.

## FR-045 — Journey Completion

A connected itinerary is fully completed only when all required flight legs have been successfully completed.

Achievements may be awarded for successful multi-leg journeys.

---

# 13. Virtual Passport and Country Collection

## FR-046 — Passport Ownership

Users may maintain a virtual passport containing completed flight records and collectible travel marks.

Guest users may maintain a temporary locally stored passport.

Registered users can synchronise their passports across devices.

## FR-047 — Passport Colour Customisation

Users may customise the passport cover.

Initial options:

- Navy blue
- Burgundy
- Forest green
- Black
- Brown
- White
- Custom colour

Standard colour customisation is free.

Premium cosmetic finishes may include distinctive textures, embossing or decorative materials.

## FR-048 — Country-Authentic Marks

Country travel marks must use documented references to actual immigration practices.

Supported categories:

- Current physical entry stamps
- Historical stamp designs
- Electronic-entry records
- Transit-only collectibles

If a country no longer issues a relevant physical stamp, the platform should use a properly labelled historical or electronic-entry-inspired collectible.

Virtual entries must be distinguishable from official immigration endorsements.

## FR-049 — Arrival Records

Every validated flight leg receives a virtual flight-completion record.

The record includes:

- Destination country
- Airport
- Flight number
- Arrival date
- Airline
- Aircraft
- Collectible design

The date is the arrival date in the user's local time zone.

## FR-050 — Country Collection

Track:

- Unique countries reached
- Airports visited
- Number of visits
- Repeat journeys
- Transit destinations
- Final destinations

Repeat visits may receive additional commemorative records.

## FR-051 — Passport Interface

Users may:

- Turn passport pages
- Review stamps
- View visit history
- Search destinations
- Inspect associated flights
- Change passport cover
- Track country-collection progress

---

# 14. Flight History, Statistics and World Globe

## FR-052 — Flight History

The flight log records:

- Airline
- Flight number
- Departure and destination
- Aircraft model
- Cabin class
- Scheduled duration
- Virtual departure and arrival
- Focus time
- Break time
- Status: complete, invalid (not validated in time), ended early or no-show
- Study goal
- Passport rewards

## FR-053 — World Globe

Provide an interactive 3D globe showing the user's completed flight routes.

Each flight leg appears as an individual route segment.

The globe supports:

- Rotation
- Zooming
- Route selection
- Airport inspection
- Country selection
- Journey history
- Route filtering

## FR-054 — Statistics Dashboard

Track:

- Total credited focus hours
- Total simulated flying hours
- Completed flights
- Airports visited
- Countries collected
- Distance travelled virtually
- Average flight completion rate
- Focus-to-break ratio
- Longest completed flight
- Study streaks
- Aircraft and airline usage

Simulated travel distance must not be presented as actual physical travel.

---

# 15. Community Flight Tracking

## FR-055 — Global Community Map

Users may view other users' active public virtual flights.

Visible aircraft are plotted on a global map.

Each marker represents one active simulated flight session. A Community Flight appears as a single aircraft with an anonymous passenger count.

## FR-056 — Public Flight Information

Selecting a public aircraft displays only:

- Origin and destination
- Flight path
- Current estimated position on the flight path

Community Flights also show the number of passengers aboard.

Users' profiles are anonymous. Public tracking must not reveal names, account details, study objectives, focus data or flight history.

## FR-057 — Show Other Flights

Users may turn the display of other users' virtual aircraft on or off.

Disabling this feature hides community traffic without affecting their own flight.

## FR-058 — Share My Flight

Users may choose whether their own active virtual flight is publicly visible.

**Default: Private.**

The user can change visibility during a flight.

Disabling sharing must promptly remove their aircraft from public discovery.

Joining a Community Flight only adds the user to its anonymous passenger count. It does not share an individual aircraft.

## FR-059 — Privacy Separation

Viewing other users' flights and sharing one's own flight are independent settings.

A user may see the community without sharing their own aircraft.

The platform must never expose users' physical locations through community flight tracking.

## FR-060 — Public Identity

The initial system uses anonymous, session-specific flight identifiers.

Real names, account identifiers, private flight history and study records are not public.

Public flight identity should not be searchable across sessions by default.

## FR-061 — Active Flight Lifecycle

Aircraft are removed from the active community map after landing, early termination or session invalidation.

Stale sessions must not remain indefinitely visible. An individual public aircraft is hidden while its session is unattended (FR-013a) and reappears when the user returns. A Community Flight stays on the map from departure to arrival.

## FR-062 — Map Performance

The global community map must support large numbers of concurrent aircraft through appropriate aggregation, clustering and update intervals.

The community visualisation must not interfere with the current user's study timer.

Positions are calculated from each flight's route, departure instant and phase model, so they do not need to be streamed. The server distributes only flight starts, visibility changes and removals.

## FR-063 — Future Social Features

Possible later extensions:

- Friends lists
- Shared study flights
- Group boarding
- Private study groups
- Community events
- Shared achievements
- Airline-themed clubs

These features are not required for the initial production release.

---

# 16. Rewards, Progression and Unlocks

## FR-064 — Frequent-Flyer Progression

Users earn progression from a combination of:

- Declared focus hours
- Completed flights
- Completed connecting journeys
- Study consistency
- Special achievements
- Country-collection milestones

## FR-065 — Proposed Reward Levels

Progression unlocks only airlines and cabin classes.

Airlines unlock in order: budget (low-cost) airlines first, then full-service airlines from lower-ranked to higher-ranked, based on the Skytrax World Airline Awards ranking. The highest-ranked airlines unlock last.

| Level | Illustrative unlock requirement | Unlocks |
|---|---|---|
| Traveller | Start (guest or new account) | Budget airlines and Economy |
| Explorer | 5 focus hours | Lowest-ranked full-service group and Premium Economy |
| Frequent Flyer | 15 hours and 5 flights | Next full-service group |
| Silver | 30 hours and 10 flights | Next full-service group and Business Class |
| Gold | 80 hours and 15 countries | Next full-service group and First Class |
| Platinum | 150 hours and 25 countries | Next full-service group and Private aviation |
| Global Voyager | 300 hours and special achievements | Highest-ranked airlines |

When a cabin class unlocks, some of the airlines unlocked by that level must offer it, so the class can actually be booked.

These thresholds and airline groupings are provisional and require user testing.

## FR-066 — Unlockable Content

Progression unlocks only:

- Airlines, in groups
- Cabin classes: Premium Economy, Business, First and Private aviation

Aircraft, routes, cabin interiors, lighting and lounges are not locked by progression. Content beyond the free tier is offered only as premium cosmetics (FR-074).

Flights on locked airlines appear in search, marked as locked, so users can see what they are working towards. Random Flight may still draw them (FR-005).

## FR-067 — Route Compatibility

Unlocked content must still respect realistic airline, route, aircraft and cabin compatibility.

The starter airline group must offer flights in every supported duration range from every supported region, so a new user can always find a flight that fits their study window. Where budget airlines cannot cover a range in a region (common for long-haul), the lowest-ranked full-service airline that can is added to the starter group.

## FR-068 — Progression Fairness

Flight completion and focus progression are separate.

A user who completes a seven-hour flight but declares only two hours of studying may receive the flight-completion collectible and two hours of focus credit.

Paid cosmetics must not substitute for earned study achievements.

---

# 17. Accounts, Profiles and Guest Mode

## FR-069 — Guest Access

Users may begin a flight without creating an account.

Guest flights, history, progression and passport are stored only on the user's device and are temporary. Guest data expires 2 weeks after the guest's last flight, and is also lost if the browser's storage is cleared. It is never stored on the server. Guests are told this before their first flight and reminded to create an account before their data expires.

Guests may join Community Flights. They are counted anonymously while aboard, and nothing about their flight is kept on the server.

## FR-070 — Account Creation

Users may register to synchronise:

- Passport
- Flight history
- Achievements
- Unlocks
- Study statistics
- Preferences
- Premium purchases

## FR-071 — Guest Conversion

Guest users should be able to create an account without losing their device-stored history.

Imported history is validated before it is accepted: each flight must match a known schedule snapshot, flights must not overlap, and none may be dated in the future.

## FR-072 — Profile Settings

Settings include:

- Home airport
- Passport colour
- Preferred airlines
- Preferred aircraft and cabin
- Break defaults
- Audio preferences
- Graphics preferences
- Announcement preferences
- Community flight privacy
- Notification settings
- Time zone (defaults to the device)
- Account and data controls

## FR-072a — Age and Minors

There is no age-specific product policy: minors use the same features as everyone else.

Because secondary-school students are a target audience, launch still requires a check that the product complies with child-privacy laws in each launch market, such as COPPA in the United States, the GDPR in the European Union and the PDPA in Singapore, and a suitable app-store age rating. These laws apply regardless of product policy.

---

# 18. Freemium and Subscription Strategy

## FR-073 — Free Product

The free tier must provide a complete core flight-study experience.

Included:

- Essential flight selection
- Validated flight durations
- Countdown and flight progress
- Basic route inspection
- Focus and break tracking
- Essential announcements
- Basic cabin environment
- Passport and travel history
- Standard passport colours
- Community flight viewing, subject to availability
- Core privacy and accessibility controls

## FR-074 — Premium Subscription

Potential premium benefits:

- Expanded aircraft interiors
- Premium cosmetic themes
- Additional cabin environments
- Enhanced scenery
- Exclusive lounge visuals
- Special audio packs
- Decorative passport finishes
- Extended cosmetic customisation

Premium should improve immersion without making free productivity functionality unreliable or unusable.

## FR-075 — Optional Purchases

Users may purchase cosmetic collections separately.

Purchases do not grant false study hours or completed-flight records.

## FR-076 — Advertising Policy

Avoid intrusive advertisements during study flights.

If advertising is introduced elsewhere, it must not interfere with focus sessions, announcements or essential controls.

## Commercial Pricing

A preliminary subscription experiment could evaluate approximately S$5.90–S$9.90 per month, alongside annual and cosmetic-purchase alternatives.

These are planning hypotheses, not validated market prices.

---

# 19. Website Information Architecture

## Main Pages

| Page | Primary purpose |
|---|---|
| Home Airport | Dashboard, departures and recommendations |
| Flight Search | Find flights that fit a study window |
| Flight Booking | Configure itinerary, departure and study settings |
| My Bookings | Upcoming booked flights, up to 7 days ahead |
| Boarding Pass | Present passenger and flight details |
| In-Flight Experience | Main study simulation |
| Flight Map | Inspect geographic route and timeline |
| Layover Terminal | Manage connecting flight breaks |
| Arrival | Review completed flight and rewards |
| Passport | Manage and inspect collectibles |
| World Globe | Visualise historical journeys |
| Hangar | View aircraft and available unlocks |
| Rewards | Frequent-flyer levels and achievements |
| Community | Explore public active virtual flights |
| Profile | Study statistics and preferences |
| Membership | Subscription and cosmetic products |
| Settings | Display, sound, privacy and account |

## Main Navigation

Recommended navigation categories:

**Fly**
- Dashboard
- Book Flight
- My Bookings
- Random Flight
- Active Flight

**Explore**
- Community Flights
- World Globe
- Airport Directory

**Collection**
- Passport
- Aircraft Hangar
- Achievements

**Account**
- Profile
- Membership
- Settings

## In-Flight Interface

The in-flight screen should prioritise:

1. Window view or map
2. Flight countdown
3. Origin and destination
4. Flight progress
5. Current study status
6. Next break
7. Audio and lighting controls
8. Map and community visibility
9. Exit or session-management options

Secondary controls should be collapsible to minimise distractions.

---

# 20. Visual and Interaction Design

## Design Direction

Aerofocus Airlines should use a professional, modern airline visual language.

Recommended characteristics:

- Clean typography
- Airport information-system influences
- Subtle aircraft-inspired iconography
- High-quality boarding pass design
- Restrained animations
- Premium cabin presentation
- Strong contrast and readable flight information
- Consistent desktop and mobile layouts

## Suggested Colour Direction

A provisional visual palette:

- Midnight navy for core flight surfaces
- Warm ivory for reading surfaces
- Soft sky blue for geographic elements
- Muted gold for premium details
- Neutral greys for supporting information

The final brand system should be validated through separate design exploration.

## Usability Principles

- New users should find a flight quickly.
- Returning users should be able to repeat a preferred configuration.
- Essential information must remain readable.
- Animations should not obstruct study activity.
- Users must be able to disable unnecessary visual effects.
- The route inspector must work without a mouse.
- The flight timer must remain operational even if rich visuals fail.

---

# 21. Technical Architecture — Proposed Direction

This section outlines a potential architecture, not implementation instructions.

## 21.1 Web Application

Candidate technologies:

- React / Next.js for the web interface
- TypeScript for shared application logic
- Three.js or React Three Fiber for aircraft and environmental visuals
- A suitable map or globe engine for route visualisation

## 21.2 Backend

Responsible for:

- Flight catalogue access
- Schedule snapshots
- User accounts
- Active sessions
- Flight history
- Rewards
- Passport collection
- Community visibility
- Subscription entitlements

## 21.3 Database

A relational database such as PostgreSQL is a plausible primary store.

## 21.4 Flight Data Layer

Responsible for:

- Aviation schedule-provider integration
- Airport and airline reference data
- Flight duration validation
- Operating-date management
- Time-zone correctness
- Aircraft compatibility
- Connection feasibility

## 21.5 Flight Simulation Engine

Should be one pure, deterministic module shared by the web client, server, community map and future mobile apps. Given a schedule snapshot, departure instant, phase model and a time, it returns the phase, position, progress and times.

Responsible for:

- Session state
- Virtual departure time
- Flight progress
- Flight phases
- Estimated position
- Focus and break records
- Arrival completion

## 21.6 Scenery and Audio Engine

Responsible for:

- Cabin environment
- Geographic scenery
- Solar position
- Visual transitions
- Aircraft ambience
- Announcements
- Service events

## 21.7 Community Tracking Layer

Responsible for:

- Public flight visibility
- Community Flight presence and passenger counts
- Active virtual aircraft positions, calculated by viewers from shared flight data
- Map discovery
- Update distribution
- Rate limiting
- Anonymous session identities
- Privacy enforcement

## 21.8 Mobile Applications

A shared architecture should be planned for future iOS and Android applications.

Native-specific background playback, notification and rendering behaviour must be validated separately.

---

# 22. Core Data Model

The conceptual system should include the following entities.

| Entity | Information stored |
|---|---|
| User | Account identity and preferences |
| Guest Session | Temporary anonymous session |
| Airport | Codes, coordinates, country, time zone |
| Airline | Operator identity and supported assets |
| Aircraft | Model and cabin configuration |
| Flight Schedule | Airline, route, date, timestamps and duration |
| Schedule Snapshot | Unchangeable copy of one operating date's schedule, bound to a booking |
| Booking | Reserved flight within the 7-day window, with type (Community or individual) and status (booked, boarded, no-show) |
| Community Flight | Shared instance of one flight number on one operating date, with an anonymous passenger count |
| Itinerary | Group of one or more flight legs |
| Flight Leg | Individual journey record |
| Seat Assignment | Seat issued for a flight leg |
| Active Flight Session | Current flight state and timing |
| Attendance Span | Heartbeat-derived attended and unattended periods, and their confirmation |
| Route Model | Expected trajectory and timing metadata |
| Focus Interval | Self-declared focused work |
| Break Interval | Rest periods |
| Announcement Event | Flight and study audio events |
| Passport | User-owned virtual collection |
| Travel Mark Design | Catalogue of collectible designs and their documented sources |
| Travel Mark | Collectible earned by a user, referencing a design |
| Flight Completion | Finalised journey result |
| Achievement | Earned progression |
| Unlock | Available content entitlement |
| Community Visibility | Public/private active-flight status |
| Subscription | Paid product entitlement |
| Purchase | One-off cosmetic purchase |
| Notification Preference | Channels for reminders, landing and break alerts |

Important relationships:

- An itinerary contains one or more flight legs.
- A flight leg references a validated schedule snapshot.
- A user can own multiple flight sessions and completion records.
- A completed flight may generate rewards and travel marks.
- Public community visibility applies to an active flight session, not to the user's entire history.
- A Community Flight groups all bookings on the same flight number and operating date.
- A flight leg becomes a completion only after validation within 10 minutes of landing.

---

# 23. Non-Functional Requirements

## NFR-001 — Reliability

Flight clocks must recover from refreshes and ordinary network interruptions.

A session must not rely solely on continuously running browser timer callbacks.

## NFR-002 — Accuracy

Published duration calculations, time zones and route inspection timestamps must be internally consistent.

## NFR-003 — Accessibility

Target WCAG 2.2 AA.

Required considerations:

- Keyboard navigation
- Screen-reader compatibility
- Captions
- Reduced motion
- Adjustable audio
- Readable text contrast
- Touch-friendly controls

## NFR-004 — Performance

Provide adaptive graphics settings and low-resource alternatives.

The primary timer must remain responsive even if complex scenery cannot render.

## NFR-005 — Security

Protect accounts, session ownership, purchases and private history.

Apply appropriate access controls, secure authentication and server-side entitlement validation.

## NFR-006 — Privacy

Public flight sharing is disabled by default.

Public views show only origin, destination, flight path and current position.

No personal physical location is required for the core virtual-flight experience.

Users must be able to disable public visibility promptly.

## NFR-007 — Data Durability

Completed flight legs, passport records and achievements must be stored consistently.

Completion processing should be idempotent to prevent duplicate rewards.

## NFR-008 — Operational Monitoring

Monitor:

- Session failures
- Schedule-data failures
- Countdown inconsistencies
- Route-calculation issues
- Flight restoration problems
- Payment failures
- Community tracking issues
- Application errors

## NFR-009 — Commercial Rights

Airline branding, aircraft assets, audio recordings, aviation datasets and passport reference designs must have suitable commercial usage rights.

## NFR-010 — Service Recovery

An already booked flight must be able to complete using its validated schedule snapshot when live catalogue services are temporarily unavailable.

---

# 24. Production Acceptance Criteria

The following scenarios are required for the relevant release.

| ID | Scenario | Expected result |
|---|---|---|
| AC-01 | Two airlines operate the same route with different published durations | Each service retains its own correct duration |
| AC-02 | User selects Depart Now | Published duration remains unchanged |
| AC-03 | User selects a custom departure time | Arrival is recalculated correctly |
| AC-04 | User books a Community Flight | Flight departs and lands at the published times with all its passengers, without live delay adjustments |
| AC-05 | User inspects a future map position | Expected location, phase and the user's local clock time are shown |
| AC-06 | User inspects a past map position | Actual flight countdown remains unchanged |
| AC-07 | User opens the route on mobile | Touch inspection works |
| AC-08 | User takes a study break | Flight continues and focus credit pauses |
| AC-09 | User works in another application | Focus is not automatically ended |
| AC-10 | User refreshes the page | Flight restores with correct remaining duration |
| AC-11 | User exits before landing | Focus saved up to the last recorded break; interval in progress and completion stamp withheld |
| AC-12 | User changes passport colour | Previous collectibles remain unchanged |
| AC-13 | Country no longer uses physical arrival stamps | Correctly labelled digital or historical collectible is used |
| AC-14 | User completes a connecting flight leg | Leg and rewards are saved |
| AC-15 | User abandons next connection | Previous legs remain; new booking required |
| AC-16 | User disables community visibility | Their virtual aircraft disappears from public tracking within 5 seconds |
| AC-17 | User hides other flights | Their own session remains unaffected |
| AC-18 | Private session attempts to appear publicly | Access is denied |
| AC-19 | 5,000 aircraft appear on the community map | Map stays at 30 frames per second or better on a mid-range phone |
| AC-20 | Paid cosmetic is purchased | Entitlement granted without altering earned focus statistics |
| AC-21 | Guest creates an account | Eligible guest history transfers correctly |
| AC-22 | Schedule provider becomes unavailable | Existing booked sessions continue safely |
| AC-23 | User enters a 2-hour study window | Only flights that fit the window are offered; none are compressed |
| AC-24 | User does not validate within 10 minutes of landing | Flight is invalid; no focus credit or collectible for that flight; legs validated before a layover keep theirs |
| AC-25 | Laptop sleeps for 30 minutes mid-flight | Flight continues; the 30 minutes are credited only if the user confirms them |
| AC-26 | User tries to book more than 7 days ahead | Booking is refused |
| AC-27 | Search results include a locked airline | Its flights show as locked and cannot be booked |
| AC-28 | Guest clears browser data | Guest history is removed; nothing remains on the server |
| AC-29 | User boards a Community Flight late, before takeoff | User joins the flight in progress; focus starts at boarding |
| AC-30 | Device clock is changed during a flight | Flight progress is unchanged |
| AC-31 | User's time zone differs from origin and destination | All clock times are shown in the user's time zone |
| AC-32 | User selects another user's public aircraft | Only origin, destination, path and current position are shown, plus passenger count on Community Flights |
| AC-33 | User requests a 90-minute Random Flight | A real flight of about 90 minutes is generated on any airline, including locked ones; Business or First appear only rarely |
| AC-34 | Guest has not flown for 2 weeks | Guest data is deleted from the device |
| AC-35 | User boards a Custom Departure 10 minutes late | Flight departs when boarding ends and lands correspondingly later |

---

# 25. Development Roadmap

## Phase 0 — Product and Commercial Validation

### Goals

Determine whether the core concept is commercially and technically viable.

### Deliverables

- Brand and trademark assessment
- Domain and app-store naming review
- Aviation schedule data-provider evaluation, including a rolling 7-day schedule window
- Child-privacy compliance check (FR-072a)
- Skytrax ranking usage-rights check (FR-065)
- Commercial rights assessment
- Defined user research plan
- Technical feasibility investigation
- Commercial model validation

### Exit Criteria

Core schedule data and essential creative assets can be obtained on commercially workable terms.

---

## Phase 1 — Production-Quality Core Flight

### Goals

Deliver a complete, reliable study-flight experience with a limited catalogue.

### Features

- Home airport
- Validated flight catalogue
- Airline-specific published durations
- Study-window booking up to 7 days ahead
- Three departure modes, with Community Flights showing an anonymous passenger count
- Quick booking
- Boarding pass
- Automatic seat assignment (wing view on individual flights)
- Short preflight
- Flight phases
- Full flight countdown
- Basic route inspector
- Basic cabin and window view
- Study and break tracking
- Essential announcements
- Audio controls
- Landing and arrival validation
- Airline and cabin-class unlocks
- Basic passport and cover colours
- Flight history
- Device-only guest mode and account support

### Exit Criteria

Users can reliably book, complete and review flights on supported desktop and mobile web browsers.

---

## Phase 2 — Advanced Immersion and Community Tracking

### Features

- More detailed aircraft cabins and aircraft-specific seat maps
- Expanded aircraft catalogue
- Geographic scenery
- Day/night lighting
- Advanced route rendering
- Full community flight map
- Public/private flight toggles
- Anonymous flight inspection
- 3D personal globe
- Expanded achievements

### Exit Criteria

The advanced experience remains reliable, performant, private and accessible.

---

## Phase 3 — Connecting Flights and Travel Collection

### Features

- Authentic multi-leg itineraries
- Scheduled layovers
- Airport terminals
- Lounges
- Connecting-flight notifications
- Connection abandonment and rebooking
- Expanded country-specific collectibles
- Detailed travel statistics
- Multi-leg achievements

### Exit Criteria

Users can complete and recover multi-leg journeys without losing completed legs or incorrectly receiving rewards.

---

## Phase 4 — Premium and Mobile Expansion

### Features

- Premium aircraft interiors
- Additional cabin-class experiences
- Cosmetic collections
- Advanced meal service
- Private aviation
- Native iOS application
- Native Android application
- Subscription and purchase improvements

### Exit Criteria

Monetisation and native features are reliable without weakening the free core study experience.

---

## Phase 5 — Social and Long-Term Expansion

### Potential Features

- Friends
- Shared study flights
- Private group sessions
- Group achievements
- Airline-themed community events
- Seasonal destinations
- Collaborative long-haul journeys
- Expanded international airline catalogue

These are future opportunities, not launch dependencies.

---

# 26. Production Success Metrics

Measure:

- New-user flight-start conversion
- Median time from opening the site to beginning a flight
- Flight completion rate
- Average declared focus minutes per session
- Focus-to-break ratio
- Seven-day returning-user rate
- Thirty-day retention
- Route inspector usage
- Passport collection engagement
- Community flight visibility opt-in
- Multi-leg itinerary completion
- Subscription conversion
- Subscription retention
- Application reliability and session-restoration success

Metrics must distinguish engagement with the flight environment from time actually declared as focused work.

---

# 27. Primary Risks and Mitigation

| Risk | Mitigation |
|---|---|
| Brand similarity with an existing AeroFocus app | Conduct name and trademark clearance before launch |
| Aviation data licensing cost | Validate a limited schedule catalogue before scaling |
| Realistic flight durations restrict short sessions | Provide duration-based route search and short authentic routes |
| Aircraft and airline asset licensing | Use properly licensed assets or explicitly labelled generic representations |
| Geographic scenery is expensive | Start with approximate route environments |
| Users leave long sessions unattended | Record declared focus time separately from flying time |
| Social tracking creates privacy risks | Private by default; anonymous public sessions |
| Mobile graphics become resource-intensive | Provide adaptive rendering and ambient mode |
| Worldwide route coverage grows too quickly | Expand by validated airport and airline groups |
| Premium features weaken free usability | Keep core focus and navigation features free |
| Passport designs are inaccurate | Maintain a sourced travel-mark catalogue |
| Product becomes more entertaining than useful | Measure focus outcomes and keep controls unobtrusive |
| Users miss the 10-minute validation window | Notify at landing; legs completed before a layover are kept |
| Budget airlines cannot cover every study window | Add the lowest-ranked full-service airline that can (FR-067) |
| Child-privacy laws apply to student users | Compliance check before launch (FR-072a) |

---

# 28. Product Strategy and Recommendations

## Recommendation 1 — Solve Naming and Commercial Rights First

Aerofocus Airlines is a working name until brand clearance is complete.

Domain availability does not establish the right to use the name commercially.

## Recommendation 2 — Make Airline-Specific Duration the Main Differentiator

Prioritise genuine schedule data, accurate time-zone handling and realistic flight length over the number of aircraft models.

## Recommendation 3 — Deliver an Excellent Flight Path Inspector

The ability to inspect expected geographical position and the user's own clock time at any point in a journey should become a signature interaction.

## Recommendation 4 — Preserve Flexible Departure Choices

Community Flights, Depart Now and Custom Departure ensure realistic flight duration remains accessible to users with different daily routines.

## Recommendation 5 — Build One Complete Flight Before a Worldwide Catalogue

A polished, reliable flight will validate the concept more effectively than a large selection of incomplete simulations.

## Recommendation 6 — Make Booking Extremely Simple

Saved configurations, favourites, recommended routes and guest access reduce the friction of beginning focused work.

## Recommendation 7 — Treat the Passport as a Serious Collection System

Use documented country references, attractive presentation, repeat visits and historical records.

## Recommendation 8 — Separate Travel Achievements from Focus Achievements

The user can successfully land without necessarily studying for every minute of the flight.

Both outcomes should be recorded accurately.

## Recommendation 9 — Implement Social Features with Privacy by Design

Community flights can make the world feel active, but users must control whether their own aircraft is visible.

## Recommendation 10 — Delay Complex Layovers Until the Core Engine Is Reliable

Connecting itineraries are valuable but introduce additional schedule, state and reward complexity.

## Recommendation 11 — Keep Essential Productivity Features Free

Premium should enhance the experience rather than impose barriers on basic study functionality.

## Recommendation 12 — Validate Real User Retention

Measure whether users repeatedly choose to study onboard virtual flights.

A visually impressive simulation is not proof of a successful productivity product.

---

# 29. Final Product Definition

Aerofocus Airlines is an aviation-inspired productivity platform that enables users to study or work onboard realistically timed virtual commercial flights.

Users can choose when they want to study, select real airline services that fit, depart at published times on shared Community Flights or at personally selected times, track geographic flight progress, inspect future or past route positions, enjoy cabin ambience, take breaks and collect journey achievements.

The platform supports personal travel history, customisable passports, authentic country-inspired collectibles, connecting itineraries, airline and aircraft progression and optional public community flight tracking.

Its core identity is built on three commitments:

**Authentic journeys. Meaningful focus. Rewarding exploration.**

---

# 30. Open Questions

None. All questions raised during the v4.1 review are resolved.

---

**Document version:** 4.1  
**Product name:** Aerofocus Airlines (provisional)  
**Status:** Consolidated planning baseline with v4.1 owner decisions  
**Implementation:** Not started  
**Next formal stage:** Brand clearance, flight-data feasibility and detailed UX design

**End of Product Requirements Document.**