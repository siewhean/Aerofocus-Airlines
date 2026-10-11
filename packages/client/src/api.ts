import type {
  AttendanceSignalKind,
  BreakSchedule,
  CabinClass,
  DisplayTime,
  FlightPlan,
  FlightState,
  InspectionPoint,
  PublicFlightDescriptor,
  ScheduleSnapshot,
  SeatAssignment,
  Segment,
  SessionOutcome,
  SessionPrompt,
  TimeSpan,
  UnlockState,
  UserStats,
} from "@aerofocus/core";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown,
  ) {
    super(message);
  }
}

export interface AirportView {
  iata: string;
  name: string;
  city: string;
  country: string;
  region: string;
  lat: number;
  lon: number;
  timeZone: string;
}

export interface Offer {
  snapshotId: string;
  mode: "community" | "depart_now" | "custom";
  flightNumber: string;
  airline: { iata: string; name: string; type: "budget" | "full_service"; tier: number; locked: boolean };
  marketingAirline: string | null;
  origin: AirportView;
  destination: AirportView;
  aircraft: { code: string | null; name: string; family: string; known: boolean };
  operatingDate: string;
  blockMs: number;
  departure: DisplayTime;
  arrival: DisplayTime;
  cabins: { cabin: CabinClass; locked: boolean }[];
  bookable: boolean;
  /** "sample" until a licensed schedule provider is connected. */
  dataSource: "verified" | "sample";
}

export interface BoardingPass {
  bookingId: string;
  status: "booked" | "boarded" | "no_show" | "cancelled";
  mode: Offer["mode"];
  flightType: "community" | "individual";
  flightNumber: string;
  airline: { iata: string; name: string };
  passengerName: string | null;
  origin: AirportView;
  destination: AirportView;
  departure: DisplayTime;
  arrival: DisplayTime;
  boardingOpensAt: DisplayTime;
  boardingClosesAt: DisplayTime;
  aircraft: Offer["aircraft"];
  cabin: CabinClass;
  seat: SeatAssignment;
  studyDurationMs: number;
  studyGoal: string | null;
  breakSchedule: BreakSchedule;
  isRandomDraw: boolean;
  operatingDate: string;
  dataSource: "verified" | "sample";
}

export interface SessionResponse {
  sessionId: string;
  boardingPass: BoardingPass;
  flight: Omit<FlightState, "arrival"> & { departure: DisplayTime; arrival: DisplayTime };
  focus: {
    state: "focus" | "break" | "awaiting_return";
    prompt: SessionPrompt;
    nextBreakAt: number | null;
    unattendedNow: boolean;
    outcome: SessionOutcome;
    validationDeadline: number;
    focusMs: number;
    breakMs: number;
    awaitingReturnMs: number;
    creditedFocusMs: number;
    creditedFlightMs: number;
    segments: Segment[];
    unattended: TimeSpan[];
  };
  isPublic: boolean;
  studyGoal: string | null;
  goalCompleted: boolean | null;
  serverTime: number;
}

export interface SearchParams {
  studyStart?: number;
  studyEnd?: number;
  mode?: "community" | "individual" | "all";
  origin?: string;
  destination?: string;
  airline?: string;
  aircraft?: string;
  cabin?: CabinClass;
  region?: string;
  minDurationMinutes?: number;
  maxDurationMinutes?: number;
  limit?: number;
  /** Guests only; signed-in users use their profile time zone. */
  timeZone?: string;
}

export interface BookingRequest {
  snapshotId: string;
  mode: Offer["mode"];
  cabin: CabinClass;
  chosenDeparture?: number | null;
  studyWindow?: { start: number; end: number } | null;
  studyGoal?: string | null;
  breakSchedule?: BreakSchedule | null;
  drawToken?: string | null;
}

export interface ApiClientOptions {
  baseUrl: string;
  token?: string | null;
  fetch?: typeof fetch;
}

/** Thin typed wrapper over the Aerofocus HTTP API. See docs/API.md for every endpoint. */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  token: string | null;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token ?? null;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async request<T>(method: string, path: string, body?: unknown, query?: Record<string, unknown>): Promise<T> {
    const qs = query
      ? "?" +
        new URLSearchParams(
          Object.entries(query)
            .filter(([, v]) => v !== undefined && v !== null)
            .map(([k, v]) => [k, String(v)]),
        ).toString()
      : "";
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    const res = await this.fetchImpl(`${this.baseUrl}${path}${qs}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { code: string; message: string; details: unknown } };
    if (!res.ok) {
      throw new ApiRequestError(res.status, json.error?.code ?? "http_error", json.error?.message ?? res.statusText, json.error?.details ?? null);
    }
    return json as T;
  }

  // Reference data
  time = () => this.request<{ now: number }>("GET", "/v1/time");
  airports = () => this.request<{ airports: AirportView[] }>("GET", "/v1/airports");
  airlines = () => this.request<{ airlines: unknown[]; promotedToStarter: string[] }>("GET", "/v1/airlines");
  aircraft = () => this.request<{ aircraft: unknown[] }>("GET", "/v1/aircraft");
  levels = () => this.request<{ levels: unknown[] }>("GET", "/v1/levels");
  rules = () => this.request<Record<string, unknown>>("GET", "/v1/rules");

  // Accounts
  async register(input: { email: string; password: string; displayName?: string | null; timeZone: string }) {
    const res = await this.request<{ token: string; user: { id: string; email: string; displayName: string | null } }>("POST", "/v1/auth/register", input);
    this.token = res.token;
    return res;
  }
  async login(input: { email: string; password: string }) {
    const res = await this.request<{ token: string; user: { id: string; email: string; displayName: string | null } }>("POST", "/v1/auth/login", input);
    this.token = res.token;
    return res;
  }
  async logout() {
    await this.request("POST", "/v1/auth/logout");
    this.token = null;
  }
  me = () => this.request<{ user: unknown; settings: Record<string, unknown> }>("GET", "/v1/me");
  updateSettings = (patch: Record<string, unknown>) => this.request<{ settings: Record<string, unknown> }>("PATCH", "/v1/me/settings", patch);
  progression = () =>
    this.request<{ stats: unknown; level: unknown; next: unknown; unlocks: UnlockState }>("GET", "/v1/me/progression");
  stats = () => this.request<{ stats: UserStats }>("GET", "/v1/me/stats");
  history = (limit = 50) => this.request<{ flights: unknown[] }>("GET", "/v1/me/history", undefined, { limit });
  passport = () => this.request<{ cover: string; marks: unknown[]; countries: { country: string; visits: number }[]; airports: unknown[] }>("GET", "/v1/me/passport");
  achievements = () => this.request<{ achievements: unknown[] }>("GET", "/v1/me/achievements");
  importGuest = (records: unknown[]) =>
    this.request<{ imported: number; rejected: { snapshotId: string; departure: number; reason: string }[] }>("POST", "/v1/me/import-guest", { records });

  // Flights
  search = (params: SearchParams) => this.request<{ offers: Offer[]; unlocks: UnlockState }>("GET", "/v1/flights/search", undefined, params as Record<string, unknown>);
  randomFlight = (studyMinutes: number, timeZone?: string) =>
    this.request<{ offer: Offer; cabin: CabinClass; drawToken: string }>("POST", "/v1/flights/random", { studyMinutes }, timeZone ? { timeZone } : undefined);
  flightPlan = (snapshotId: string, departure?: number) =>
    this.request<{ snapshot: ScheduleSnapshot; plan: FlightPlan }>("GET", `/v1/flights/${encodeURIComponent(snapshotId)}/plan`, undefined, { departure });

  // Bookings
  book = (input: BookingRequest) => this.request<{ boardingPass: BoardingPass }>("POST", "/v1/bookings", input);
  bookings = () => this.request<{ bookings: BoardingPass[] }>("GET", "/v1/bookings");
  booking = (id: string) => this.request<{ boardingPass: BoardingPass }>("GET", `/v1/bookings/${id}`);
  cancelBooking = (id: string) => this.request<{ ok: true }>("DELETE", `/v1/bookings/${id}`);
  board = (id: string) => this.request<{ sessionId: string }>("POST", `/v1/bookings/${id}/board`);

  // Flight sessions
  activeSession = () => this.request<{ session: SessionResponse | null }>("GET", "/v1/sessions/active");
  session = (id: string) => this.request<SessionResponse>("GET", `/v1/sessions/${id}`);
  heartbeat = (id: string, kind: AttendanceSignalKind = "beat") => this.request<SessionResponse>("POST", `/v1/sessions/${id}/heartbeat`, { kind });
  startBreak = (id: string) => this.request<SessionResponse>("POST", `/v1/sessions/${id}/break/start`);
  endBreak = (id: string) => this.request<SessionResponse>("POST", `/v1/sessions/${id}/break/end`);
  imBack = (id: string) => this.request<SessionResponse>("POST", `/v1/sessions/${id}/back`);
  exitFlight = (id: string) => this.request<SessionResponse>("POST", `/v1/sessions/${id}/exit`);
  validate = (id: string, input: { confirmUnattendedStarts?: number[]; goalCompleted?: boolean | null } = {}) =>
    this.request<SessionResponse>("POST", `/v1/sessions/${id}/validate`, input);
  setVisibility = (id: string, isPublic: boolean) => this.request<SessionResponse>("PATCH", `/v1/sessions/${id}/visibility`, { isPublic });
  sessionRoute = (id: string) => this.request<{ plan: FlightPlan }>("GET", `/v1/sessions/${id}/route`);
  inspect = (id: string, at: { offsetMs?: number; fraction?: number; lat?: number; lon?: number }) =>
    this.request<{ point: InspectionPoint }>("GET", `/v1/sessions/${id}/inspect`, undefined, at);

  // Community
  communityFlights = () => this.request<{ flights: PublicFlightDescriptor[]; serverTime: number }>("GET", "/v1/community/flights");
  communityFlight = (key: string) => this.request<{ passengerCount: number }>("GET", `/v1/community/flights/${encodeURIComponent(key)}`);
  guestPresence = (communityKey: string, presenceId: string, leaving = false) =>
    this.request<{ passengerCount: number }>("POST", "/v1/community/presence", { communityKey, presenceId, leaving });
}
