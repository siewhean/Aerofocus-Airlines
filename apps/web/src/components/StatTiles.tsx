/** Statistics as a definition list (FR-054). Simulated figures are labelled as such; nothing here is physical travel. */
import type { UserStats } from "@aerofocus/core";
import { formatDuration, formatHours, percent } from "../lib/format";
import "./StatTiles.css";

interface Tile {
  label: string;
  value: string;
  title?: string;
}

function ratio(value: number | null): string {
  if (value === null) return "—";
  if (!Number.isFinite(value)) return "No breaks";
  return `${(Math.round(value * 10) / 10).toFixed(1)} : 1`;
}

export function StatTiles({ stats }: { stats: UserStats }) {
  const tiles: Tile[] = [
    { label: "Focus hours", value: formatHours(stats.creditedFocusMs) },
    { label: "Flights", value: String(stats.completedFlights) },
    { label: "Airports", value: String(stats.airportsVisited) },
    { label: "Countries", value: String(stats.countriesCollected) },
    { label: "Simulated flying", value: formatHours(stats.simulatedFlightMs), title: "Not physical travel" },
    { label: "Distance", value: `${Math.round(stats.virtualDistanceKm).toLocaleString()} km, virtual`, title: "Not physical travel" },
    { label: "Completion rate", value: stats.completionRate === null ? "—" : percent(stats.completionRate) },
    { label: "Focus to break ratio", value: ratio(stats.focusToBreakRatio) },
    { label: "Longest flight", value: stats.longestCompletedFlightMs > 0 ? formatDuration(stats.longestCompletedFlightMs) : "—" },
    { label: "Streak", value: `${stats.currentStreakDays} ${stats.currentStreakDays === 1 ? "day" : "days"}` },
  ];
  return (
    <dl className="stat-tiles">
      {tiles.map((t) => (
        <div key={t.label} className="stat-tile" title={t.title}>
          <dt>{t.label}</dt>
          <dd className="numeral">{t.value}</dd>
        </div>
      ))}
    </dl>
  );
}
