import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { formatClock } from "../lib/format";
import { useSession } from "../lib/session";
import { Icon } from "../ui/Icon";
import { WAYFINDING } from "./nav";
import "./Shell.css";

/** A live clock in the user's own time zone (FR-012). Ticks once a minute. */
export function LocalClock({ seconds = false }: { seconds?: boolean }) {
  const { now, timeZone } = useSession();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), seconds ? 1000 : 10_000);
    return () => clearInterval(id);
  }, [seconds]);
  const t = now();
  return (
    <time className="numeral" dateTime={new Date(t).toISOString()} title={timeZone}>
      {formatClock(t, timeZone)}
    </time>
  );
}

function isActive(pathname: string, match: string[]): boolean {
  return match.some((m) => (m === "/" ? pathname === "/" : pathname === m || pathname.startsWith(`${m}/`)));
}

/**
 * The shell is a wayfinding strip, not a dashboard rail (Phase 8): wordmark, five links named as
 * a passenger reads them in an airport, the local clock. Pages link onward through their content.
 */
export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { mode, user } = useSession();

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="wayfinding">
        <Link to="/" className="wayfinding-brand" aria-label="Aerofocus Airlines, departures">
          <span className="wayfinding-mark" aria-hidden="true">
            <Icon name="plane" size={18} />
          </span>
          <span className="wayfinding-name">Aerofocus</span>
        </Link>
        <nav className="wayfinding-links" aria-label="Wayfinding">
          {WAYFINDING.map((w) => {
            const active = isActive(pathname, w.match);
            return (
              <Link key={w.to} to={w.to} className={`wayfinding-link ${active ? "is-active" : ""}`} aria-current={active ? "page" : undefined}>
                {w.label}
              </Link>
            );
          })}
        </nav>
        <div className="wayfinding-aside">
          <span className="wayfinding-who small muted">{mode === "user" ? (user?.displayName ?? "Signed in") : "Guest"}</span>
          <LocalClock />
        </div>
      </header>

      <main id="main" className="content">
        {children}
      </main>
    </div>
  );
}

/** Page frame: title row with the user's clock, then content in the reading column. */
export function Page({ title, lead, aside, children, wide }: { title: ReactNode; lead?: ReactNode; aside?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`page ${wide ? "page-wide" : ""}`}>
      <header className="page-header">
        <div>
          <h1>{title}</h1>
          {lead && <p className="muted page-lead">{lead}</p>}
        </div>
        <div className="page-aside">{aside}</div>
      </header>
      <div className="page-body">{children}</div>
    </div>
  );
}
