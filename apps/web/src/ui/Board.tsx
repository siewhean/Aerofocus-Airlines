import type { ReactNode, TableHTMLAttributes } from "react";
import "./Board.css";

/**
 * Departure-board table. Rows are the information; rules and tabular numerals carry structure.
 * Use <Board.Row> cells with `num` for right-aligned numerals.
 */
export function Board({ caption, children, ...rest }: { caption: string; children: ReactNode } & TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="board-scroll">
      <table className="board" {...rest}>
        <caption className="visually-hidden">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function Cell({ num, children, className, colSpan, head }: { num?: boolean; children?: ReactNode; className?: string; colSpan?: number; head?: boolean }) {
  const cls = [num ? "num" : "", className ?? ""].join(" ").trim();
  return head ? (
    <th scope="col" className={cls} colSpan={colSpan}>
      {children}
    </th>
  ) : (
    <td className={cls} colSpan={colSpan}>
      {children}
    </td>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "neutral", children }: { tone?: "neutral" | "amber" | "danger" | "signal"; children: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "danger" ? "alert" : undefined}>
      {children}
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton" aria-busy="true" aria-live="polite">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton-line" style={{ width: `${70 + ((i * 13) % 30)}%` }} />
      ))}
    </div>
  );
}

/** Pairs of label/value, used on passes and detail panels. */
export function Facts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="facts">
      {items.map((f) => (
        <div key={f.label} className="fact">
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      {(title || aside) && (
        <header className="section-header">
          {title && <h2>{title}</h2>}
          {aside && <div className="section-aside">{aside}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
