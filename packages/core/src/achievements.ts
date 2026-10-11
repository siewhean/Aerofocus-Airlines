import type { FlightRecord, UserStats } from "./stats";
import { HOUR } from "./time";

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  /** Special achievements count towards Global Voyager (FR-065). */
  special: boolean;
  earned: (ctx: { stats: UserStats; records: readonly FlightRecord[] }) => boolean;
}

/** Initial achievement set. Earned only from validated flights and credited focus, never from purchases (FR-068). */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: "first_flight",
    name: "Wheels Up",
    description: "Complete your first flight",
    special: false,
    earned: ({ stats }) => stats.completedFlights >= 1,
  },
  {
    id: "long_haul",
    name: "Long Haul",
    description: "Complete a flight of 8 hours or more",
    special: true,
    earned: ({ stats }) => stats.longestCompletedFlightMs >= 8 * HOUR,
  },
  {
    id: "ultra_long_haul",
    name: "Ultra Long Haul",
    description: "Complete a flight of 14 hours or more",
    special: true,
    earned: ({ stats }) => stats.longestCompletedFlightMs >= 14 * HOUR,
  },
  {
    id: "five_countries",
    name: "Passport Stamper",
    description: "Reach 5 different countries",
    special: false,
    earned: ({ stats }) => stats.countriesCollected >= 5,
  },
  {
    id: "seven_day_streak",
    name: "Week of Focus",
    description: "Study on 7 consecutive days",
    special: true,
    earned: ({ stats }) => stats.currentStreakDays >= 7,
  },
  {
    id: "hundred_hours",
    name: "Centurion",
    description: "Earn 100 hours of credited focus",
    special: true,
    earned: ({ stats }) => stats.creditedFocusMs >= 100 * HOUR,
  },
  {
    id: "goal_getter",
    name: "Goal Getter",
    description: "Complete 10 flights",
    special: false,
    earned: ({ stats }) => stats.completedFlights >= 10,
  },
];

export function earnedAchievements(stats: UserStats, records: readonly FlightRecord[]): AchievementDef[] {
  return ACHIEVEMENTS.filter((a) => a.earned({ stats, records }));
}
