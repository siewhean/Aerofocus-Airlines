import { ApiClient, ApiRequestError, ServerClock } from "@aerofocus/client";

/** Base URL: same-origin in dev (Vite proxies /v1 to 8787), or VITE_API_URL in production. */
export const API_BASE_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export const TOKEN_KEY = "aerofocus.token";

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: session will not persist across reloads */
  }
}

/** One client for the whole app. `api.token` is the public field the library exposes (api.ts:149). */
export const api = new ApiClient({ baseUrl: API_BASE_URL, token: readToken() });

/** Server clock (AC-30). Synced on boot and every 10 minutes by the SessionProvider. */
export const clock = new ServerClock(async () => (await api.time()).now);

export { ApiRequestError };

/** User-facing copy for API error codes (docs/API.md). */
const ERROR_COPY: Record<string, string> = {
  outside_booking_window: "That departure is outside the booking window.",
  departure_in_past: "That departure time has already passed.",
  boarding_closed: "Boarding for this flight has closed.",
  cabin_not_offered: "This flight does not offer that cabin.",
  cabin_locked: "You have not unlocked that cabin yet.",
  airline_locked: "You have not unlocked this airline yet.",
  missing_chosen_departure: "Choose a departure time first.",
  does_not_fit_study_window: "This flight does not fit inside your study window.",
  flight_in_progress: "You already have a flight in progress. Land it first.",
  invalid_draw_token: "This random draw has expired. Draw again.",
  too_early: "Boarding has not opened yet.",
  no_show: "This booking lapsed. The flight has already departed.",
  already_boarded: "You have already boarded this flight.",
  unauthorized: "Sign in to continue.",
  invalid_credentials: "That email and password do not match.",
  email_taken: "An account with that email already exists.",
  http_error: "The airline systems did not respond. Try again.",
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) return ERROR_COPY[err.code] ?? err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

/** Route params are interpolated into API paths by the client library; only UUIDs may pass. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function errorCode(err: unknown): string | null {
  return err instanceof ApiRequestError ? err.code : null;
}
