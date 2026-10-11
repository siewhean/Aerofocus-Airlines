import { SampleScheduleProvider, type ScheduleProvider } from "@aerofocus/data";
import { createApp } from "../src/app";
import { buildDeps, type AppDeps } from "../src/context";
import { connectPglite } from "../src/db/client";

/** Monday 12 Oct 2026, 00:00 UTC (08:00 in Singapore). */
export const T0 = Date.UTC(2026, 9, 12, 0, 0);
export const MIN = 60_000;
export const HOUR = 60 * MIN;

export interface TestEnv {
  deps: AppDeps;
  clock: { t: number; now(): number };
  call<T = any>(method: string, path: string, options?: { token?: string; body?: unknown }): Promise<{ status: number; body: T }>;
  register(email?: string, timeZone?: string): Promise<string>;
  close(): Promise<void>;
}

let counter = 0;

export async function createTestEnv(options: { provider?: ScheduleProvider; random?: () => number } = {}): Promise<TestEnv> {
  const handle = connectPglite();
  await handle.migrate();
  const clock = { t: T0, now() { return this.t; } };
  let seed = 7;
  const random = options.random ?? (() => ((seed = (seed * 16807) % 2147483647) / 2147483647));
  const deps = await buildDeps({
    db: handle.db,
    provider: options.provider ?? new SampleScheduleProvider(),
    clock,
    signingSecret: "test-secret",
    random,
  });
  const app = createApp(deps);

  const call: TestEnv["call"] = async (method, path, opts = {}) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    const res = await app.request(path, {
      method,
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    return { status: res.status, body: await res.json() };
  };

  const register: TestEnv["register"] = async (email, timeZone = "Asia/Singapore") => {
    const res = await call("POST", "/v1/auth/register", {
      body: { email: email ?? `user${++counter}@example.com`, password: "correct horse", displayName: "Ava", timeZone },
    });
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    return res.body.token as string;
  };

  return { deps, clock, call, register, close: () => handle.close() };
}
