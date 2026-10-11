/**
 * Typed wrappers for server responses that the client library types more narrowly than the server
 * returns, and for endpoints without a client method. Shapes copied from:
 *   apps/api/src/routes/flights.ts:93-135, sessions.ts:150-204, me.ts:150-247, community.ts:136-196
 */
import type {
  Airline,
  AircraftType,
  BreakSchedule,
  CabinClass,
  ClusterResult,
  DisplayTime,
  FlightPhase,
  FlightPlan,
  InspectionPoint,
  LatLon,
  PublicFlightDescriptor,
  RouteFacts,
  ScheduleSnapshot,
  SeatAssignment,
  SeatMap,
  TimelineEntry,
  WindowLighting,
  UnlockState,
  UserStats,
  FeatureCollection,
  Feature,
  PointGeometry,
  MultiLineStringGeometry,
  RouteFeatureProperties,
  DaylightCondition,
  Daylight,
  LevelDef,
  NextLevelProgress,
  ProgressStats,
} from "@aerofocus/core";
import type { AirportView } from "@aerofocus/client";
import { api } from "./api";

/** Copied from packages/geo/src/scenery.ts:90-100 so the browser bundle never imports @aerofocus/geo. */
export interface Scenery {
  surface: "ocean" | "land" | "coast";
  country: string | null;
  placeLabel: string;
  nearAirport: string | null;
  altitudeBand: "ground" | "low" | "cruise";
  daylight: Daylight;
  clouds: { coverage: number; layer: "clear" | "scattered" | "broken" | "overcast" };
  simulated: true;
}

export type RouteGeometry = FeatureCollection<Feature<PointGeometry | MultiLineStringGeometry, RouteFeatureProperties>>;

export interface DaylightEventView {
  type: "sunrise" | "sunset";
  instant: number;
  position: LatLon;
  time: DisplayTime;
}

export interface FlightPlanFull {
  snapshot: ScheduleSnapshot;
  plan: FlightPlan;
  geometry: RouteGeometry;
  timeline: TimelineEntry[];
  daylightEvents: DaylightEventView[];
  facts: RouteFacts;
  seatMap: SeatMap | null;
}

export interface SessionRouteFull {
  plan: FlightPlan;
  geometry: RouteGeometry;
  timeline: TimelineEntry[];
  daylightEvents: DaylightEventView[];
}

export interface SceneryResponse {
  scenery: Scenery;
  window: WindowLighting;
  seat: SeatAssignment;
  phase: FlightPhase | null;
  altitudeFt: number;
}

export type LabelledInspectionPoint = InspectionPoint & { placeLabel: string };

export interface RulesResponse {
  bookingWindowDays: number;
  communityBoardingOpensMs: number;
  boardingSequenceMs: number;
  validationWindowMs: number;
  heartbeatIntervalMs: number;
  unattendedThresholdMs: number;
  guestDataTtlMs: number;
  defaultBreakSchedule: BreakSchedule;
  randomCabinWeights: Record<string, number>;
  passportColours: readonly string[];
}

export interface AirlineView extends Airline {
  tier: number;
}

export type LevelView = LevelDef;

export interface AchievementView {
  id: string;
  name: string;
  description: string;
  category: string;
  special: boolean;
  earnedAt?: number | null;
}

export interface HistoryItem {
  sessionId: string;
  flightNumber: string;
  airline: string;
  origin: string;
  destination: string;
  aircraft: { code: string | null; name: string; family: string; known: boolean };
  cabin: CabinClass;
  mode: "community" | "depart_now" | "custom";
  scheduledBlockMs: number;
  departure: number;
  arrival: number;
  status: "complete" | "invalid" | "ended_early" | "in_flight" | "no_show";
  creditedFocusMs: number;
  breakMs?: number;
  studyGoal?: string | null;
  goalCompleted?: boolean | null;
  travelMark?: TravelMarkView | null;
  dataSource?: "verified" | "sample";
}

export interface TravelMarkView {
  id: string;
  sessionId?: string;
  country: string;
  airport: string;
  flightNumber?: string;
  airline?: string;
  aircraftType?: string | null;
  arrivalDate: string;
  designId?: string;
  category?: string;
  createdAt?: number;
}

export interface PassportResponse {
  cover: string;
  marks: TravelMarkView[];
  countries: { country: string; visits: number }[];
  airports: (AirportView | { iata: string })[];
}

export interface GlobeLegProperties {
  kind: "leg";
  legId: string;
  flightNumber: string;
  airline: string;
  origin: string;
  destination: string;
  destinationCountry: string;
  departure: number;
  arrivalDate: string;
  blockMs: number;
  estimated: true;
}
export interface GlobeAirportProperties {
  kind: "airport";
  iata: string;
  name: string;
  city: string;
  country: string;
  visits: number;
}
export interface GlobeResponse {
  type: "FeatureCollection";
  features: (Feature<MultiLineStringGeometry, GlobeLegProperties> | Feature<PointGeometry, GlobeAirportProperties>)[];
  countries: string[];
  legCount: number;
}

export interface CommunityClustersResponse {
  items: ClusterResult<PublicFlightDescriptor>[];
  total: number;
  serverTime: number;
}

export interface PublicFlightResponse {
  flight: PublicFlightDescriptor;
  position: LatLon;
  path: RouteGeometry;
  serverTime: number;
}

export interface ProgressionResponse {
  stats: ProgressStats;
  level: LevelDef;
  next: NextLevelProgress | null;
  unlocks: UnlockState;
}

export interface SettingsView {
  displayName?: string | null;
  timeZone: string;
  homeAirport: string | null;
  passportColour: string;
  breakSchedule: BreakSchedule;
  shareFlightsByDefault: boolean;
  showCommunityFlights: boolean;
  preferredAirlines: string[];
  notifications: { boardingReminder: boolean; breakEnd: boolean; landing: boolean; channel: "push" | "sound" | "both" | "none" };
  uiPreferences: Record<string, unknown>;
}

export interface UserView {
  id: string;
  email: string;
  displayName: string | null;
}

export type { Daylight, DaylightCondition };

const q = (query: Record<string, unknown>) => query;

export const apiExt = {
  rules: () => api.rules() as unknown as Promise<RulesResponse>,
  airlines: () => api.airlines() as Promise<{ airlines: AirlineView[]; promotedToStarter: string[] }>,
  aircraft: () => api.aircraft() as Promise<{ aircraft: AircraftType[] }>,
  levels: () => api.levels() as Promise<{ levels: LevelView[] }>,
  achievementCatalogue: () => api.request<{ achievements: AchievementView[] }>("GET", "/v1/achievements"),
  me: () => api.me() as unknown as Promise<{ user: UserView; settings: SettingsView }>,
  updateSettings: (patch: Partial<SettingsView>) => api.updateSettings(patch) as unknown as Promise<{ settings: SettingsView }>,
  progression: () => api.progression() as Promise<ProgressionResponse>,
  history: (limit = 50) => api.history(limit) as Promise<{ flights: HistoryItem[] }>,
  passport: () => api.passport() as Promise<PassportResponse>,
  achievements: () => api.achievements() as Promise<{ achievements: AchievementView[] }>,

  flightPlanFull: (snapshotId: string, departure?: number, timeZone?: string) =>
    api.request<FlightPlanFull>("GET", `/v1/flights/${encodeURIComponent(snapshotId)}/plan`, undefined, q({ departure, timeZone })),
  previewInspect: (snapshotId: string, at: { departure?: number; offsetMs?: number; fraction?: number; timeZone?: string }) =>
    api.request<{ point: LabelledInspectionPoint }>("GET", `/v1/flights/${encodeURIComponent(snapshotId)}/inspect`, undefined, q(at)),
  airport: (iata: string) => api.request<{ airport: AirportView }>("GET", `/v1/flights/airports/${encodeURIComponent(iata)}`),

  sessionRouteFull: (id: string) => api.sessionRoute(id) as Promise<SessionRouteFull>,
  scenery: (id: string) => api.request<SceneryResponse>("GET", `/v1/sessions/${encodeURIComponent(id)}/scenery`),
  inspect: (id: string, at: { offsetMs?: number; fraction?: number; lat?: number; lon?: number }) =>
    api.inspect(id, at) as Promise<{ point: LabelledInspectionPoint }>,

  globe: (filters: { airline?: string; country?: string; from?: number; to?: number } = {}) =>
    api.request<GlobeResponse>("GET", "/v1/me/globe", undefined, q(filters)),

  communityClusters: (zoom: number, bbox?: [number, number, number, number]) =>
    api.request<CommunityClustersResponse>("GET", "/v1/community/flights", undefined, q({ zoom, bbox: bbox?.join(",") })),
  publicFlight: (id: string) => api.request<PublicFlightResponse>("GET", `/v1/community/flights/public/${encodeURIComponent(id)}`),
};
