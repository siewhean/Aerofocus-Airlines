import type { ScheduleSnapshot } from "./schedule";
import { localDate, type Instant } from "./time";

export type TravelMarkCategory = "current_physical" | "historical" | "electronic" | "transit" | "generic";

/** Catalogue entry for a collectible design and its documented source (FR-048). */
export interface TravelMarkDesign {
  id: string;
  /** ISO country code, or null for the generic design. */
  country: string | null;
  category: TravelMarkCategory;
  label: string;
  /** Reference documenting the real practice the design draws on. Required unless generic. */
  sourceRef: string | null;
}

/** Fallback used until a sourced design exists for a country. Clearly not an official endorsement. */
export const GENERIC_MARK_DESIGN: TravelMarkDesign = {
  id: "generic-arrival",
  country: null,
  category: "generic",
  label: "Aerofocus virtual arrival",
  sourceRef: null,
};

export function selectMarkDesign(designs: readonly TravelMarkDesign[], country: string, isTransit: boolean): TravelMarkDesign {
  const forCountry = designs.filter((d) => d.country === country && d.sourceRef !== null);
  const preferred: TravelMarkCategory[] = isTransit
    ? ["transit", "electronic", "current_physical", "historical"]
    : ["current_physical", "electronic", "historical"];
  for (const category of preferred) {
    const design = forCountry.find((d) => d.category === category);
    if (design) return design;
  }
  return GENERIC_MARK_DESIGN;
}

/** Collectible earned by a validated flight leg (FR-049). Always marked virtual (FR-048). */
export interface TravelMark {
  country: string;
  airport: string;
  flightNumber: string;
  airline: string;
  aircraftType: string | null;
  /** Arrival date in the user's local time zone (FR-049). */
  arrivalDate: string;
  designId: string;
  virtual: true;
  /** True for an intermediate (layover) airport of an itinerary (FR-048, FR-049). */
  isTransit: boolean;
  /** How many times the user has now reached this country, transit and final arrivals together (FR-050). */
  visitNumber: number;
}

/** visitNumber for a new mark: previous marks in the same country + 1 (FR-050). */
export function nextVisitNumber(previousMarks: readonly Pick<TravelMark, "country">[], country: string): number {
  return previousMarks.filter((m) => m.country === country).length + 1;
}

export function buildTravelMark(input: {
  snapshot: ScheduleSnapshot;
  destinationCountry: string;
  arrival: Instant;
  userTimeZone: string;
  designs: readonly TravelMarkDesign[];
  isTransit?: boolean;
  /** Defaults to 1; compute with nextVisitNumber. */
  visitNumber?: number;
}): TravelMark {
  const isTransit = input.isTransit ?? false;
  const design = selectMarkDesign(input.designs, input.destinationCountry, isTransit);
  return {
    country: input.destinationCountry,
    airport: input.snapshot.destination,
    flightNumber: `${input.snapshot.operatingAirline}${input.snapshot.flightNumber}`,
    airline: input.snapshot.operatingAirline,
    aircraftType: input.snapshot.aircraftType,
    arrivalDate: localDate(input.arrival, input.userTimeZone),
    designId: design.id,
    virtual: true,
    isTransit,
    visitNumber: input.visitNumber ?? 1,
  };
}

export const PASSPORT_COLOURS = ["navy", "burgundy", "forest_green", "black", "brown", "white"] as const;
export type PassportColour = (typeof PASSPORT_COLOURS)[number] | `custom:#${string}`;

const HEX_RE = /^custom:#[0-9a-fA-F]{6}$/;

export function isValidPassportColour(value: string): value is PassportColour {
  return (PASSPORT_COLOURS as readonly string[]).includes(value) || HEX_RE.test(value);
}
