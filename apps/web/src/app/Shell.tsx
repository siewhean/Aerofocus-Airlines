import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router";
import { formatClock } from "../lib/format";
import { useSession } from "../lib/session";
import { Icon } from "../ui/Icon";
import { NAV } from "./nav";
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

export function Shell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <nav className={`rail ${open ? "is-open" : ""}`} aria-label="Main">
        <div className="rail-brand">
          <span className="rail-mark" aria-hidden="true">
            <Icon name="plane" size={22} />
          </span>
          <span className="rail-name">Aerofocus</span>
          <button type="button" className="rail-toggle" aria-expanded={open} aria-controls="rail-groups" onClick={() => setOpen((o) => !o)}>
            <Icon name={open ? "close" : "menu"} />
            <span className="visually-hidden">Menu</span>
          </button>
        </div>
        <div id="rail-groups" className="rail-groups">
          {NAV.map((group) => (
            <div key={group.label} className="rail-group">
              <div className="rail-group-label">{group.label}</div>
              <ul>
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink to={item.to} end={item.to === "/"} className={({ isActive }) => `rail-link ${isActive ? "is-active" : ""}`}>
                      <Icon name={item.icon} />
                      <span>{item.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <main id="main" className="content">
        {children}
      </main>

      <nav className="tabbar" aria-label="Sections">
        {NAV.map((group) => {
          const item = group.items.find((i) => i.primary) ?? group.items[0]!;
          const active = group.items.some((i) => (i.to === "/" ? pathname === "/" : pathname.startsWith(i.to.split("/").slice(0, 2).join("/"))));
          return (
            <NavLink key={group.label} to={item.to} end={item.to === "/"} className={`tab ${active ? "is-active" : ""}`} aria-current={active ? "page" : undefined}>
              <Icon name={item.icon} />
              <span>{group.label}</span>
            </NavLink>
          );
        })}
      </nav>
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
