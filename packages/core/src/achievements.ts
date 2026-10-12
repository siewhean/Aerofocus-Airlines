import { recordFocusMs, type FlightRecord, type UserStats } from "./stats";
import { DAY, HOUR } from "./time";

export interface AchievementContext {
  stats: UserStats;
  records: readonly FlightRecord[];
  now: number;
}

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  category: "milestone" | "collection" | "route" | "consistency" | "community" | "journey";
  /** Special achievements count towards Global Voyager (FR-065). */
  special: boolean;
  earned: (ctx: AchievementContext) => boolean;
}

const completed = (records: readonly FlightRecord[]): FlightRecord[] => records.filter((r) => r.outcome === "complete");

/**
 * Achievement catalogue. Earned only from validated flights and credited focus, never from
 * purchases (FR-068). Thresholds are provisional.
 */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // Milestones
  { id: "first_flight", name: "Wheels Up", description: "Complete your first flight", category: "milestone", special: false,
    earned: ({ stats }) => stats.completedFlights >= 1 },
  { id: "goal_getter", name: "Goal Getter", description: "Complete 10 flights", category: "milestone", special: false,
    earned: ({ stats }) => stats.completedFlights >= 10 },
  { id: "fifty_flights", name: "Frequent Flyer", description: "Complete 50 flights", category: "milestone", special: true,
    earned: ({ stats }) => stats.completedFlights >= 50 },
  { id: "hundred_hours", name: "Centurion", description: "Earn 100 hours of credited focus", category: "milestone", special: true,
    earned: ({ stats }) => stats.creditedFocusMs >= 100 * HOUR },
  { id: "long_haul", name: "Long Haul", description: "Complete a flight of 8 hours or more", category: "milestone", special: true,
    earned: ({ stats }) => stats.longestCompletedFlightMs >= 8 * HOUR },
  { id: "ultra_long_haul", name: "Ultra Long Haul", description: "Complete a flight of 14 hours or more", category: "milestone", special: true,
    earned: ({ stats }) => stats.longestCompletedFlightMs >= 14 * HOUR },

  // Collection
  { id: "five_countries", name: "Passport Stamper", description: "Reach 5 different countries", category: "collection", special: false,
    earned: ({ stats }) => stats.countriesCollected >= 5 },
  { id: "ten_countries", name: "Globetrotter", description: "Reach 10 different countries", category: "collection", special: true,
    earned: ({ stats }) => stats.countriesCollected >= 10 },
  { id: "twenty_five_countries", name: "World Citizen", description: "Reach 25 different countries", category: "collection", special: true,
    earned: ({ stats }) => stats.countriesCollected >= 25 },
  { id: "airline_collector", name: "Airline Collector", description: "Complete flights with 10 different airlines", category: "collection", special: true,
    earned: ({ stats }) => Object.keys(stats.airlineUsage).length >= 10 },
  { id: "aircraft_spotter", name: "Aircraft Spotter", description: "Complete flights on 5 different aircraft types", category: "collection", special: false,
    earned: ({ stats }) => Object.keys(stats.aircraftUsage).length >= 5 },

  // Route
  { id: "equator_crosser", name: "Line Crosser", description: "Cross the equator", category: "route", special: false,
    earned: ({ records }) => completed(records).some((r) => r.facts?.crossedEquator) },
  { id: "dateline_crosser", name: "Time Traveller", description: "Cross the International Date Line", category: "route", special: true,
    earned: ({ records }) => completed(records).some((r) => r.facts?.crossedAntimeridian) },
  { id: "dawn_patrol", name: "Dawn Patrol", description: "Fly through a sunrise", category: "route", special: false,
    earned: ({ records }) => completed(records).some((r) => r.facts?.sawSunrise) },
  { id: "red_eye", name: "Red-Eye", description: "Complete a flight with 3 or more hours of darkness", category: "route", special: false,
    earned: ({ records }) => completed(records).some((r) => r.facts?.nightFlight) },

  // Consistency
  { id: "seven_day_streak", name: "Week of Focus", description: "Study on 7 consecutive days", category: "consistency", special: true,
    earned: ({ stats }) => stats.currentStreakDays >= 7 },
  { id: "thirty_day_streak", name: "Month of Focus", description: "Study on 30 consecutive days", category: "consistency", special: true,
    earned: ({ stats }) => stats.currentStreakDays >= 30 },
  { id: "marathon_week", name: "Marathon Week", description: "Earn 20 hours of credited focus within 7 days", category: "consistency", special: true,
    earned: ({ records, now }) => records.filter((r) => r.arrival > now - 7 * DAY).reduce((s, r) => s + recordFocusMs(r), 0) >= 20 * HOUR },

  // Community
  { id: "community_regular", name: "Community Regular", description: "Complete 5 Community Flights", category: "community", special: false,
    earned: ({ records }) => completed(records).filter((r) => r.mode === "community").length >= 5 },

  // Journey: multi-leg itineraries (FR-045)
  { id: "first_connection", name: "First Connection", description: "Complete an itinerary of 2 or more legs", category: "journey", special: false,
    earned: ({ stats }) => stats.multiLegItinerariesCompleted >= 1 },
  { id: "three_leg_journey", name: "Three-Leg Journey", description: "Complete an itinerary of 3 legs", category: "journey", special: false,
    earned: ({ stats }) => stats.longestCompletedItineraryLegs >= 3 },
  { id: "hub_hopper", name: "Hub Hopper", description: "Transit through 5 different airports", category: "journey", special: true,
    earned: ({ stats }) => stats.transitAirports >= 5 },
  { id: "smooth_operator", name: "Smooth Operator", description: "Complete 5 multi-leg itineraries", category: "journey", special: true,
    earned: ({ stats }) => stats.multiLegItinerariesCompleted >= 5 },
  { id: "lounge_regular", name: "Lounge Regular", description: "Complete 5 layovers with premium lounge access", category: "journey", special: false,
    earned: ({ stats }) => stats.premiumLoungeLayovers >= 5 },
];

export function earnedAchievements(stats: UserStats, records: readonly FlightRecord[], now: number = Date.now()): AchievementDef[] {
  return ACHIEVEMENTS.filter((a) => a.earned({ stats, records, now }));
}
