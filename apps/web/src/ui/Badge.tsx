import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import "./Badge.css";

type Tone = "neutral" | "signal" | "amber" | "premium" | "geo" | "danger";

export function Badge({ tone = "neutral", icon, children, title }: { tone?: Tone; icon?: IconName; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  );
}

/** Shown wherever dataSource is "sample" (docs/API.md). */
export function SampleBadge({ dataSource }: { dataSource: "verified" | "sample" }) {
  if (dataSource !== "sample") return null;
  return (
    <Badge tone="neutral" title="These times are illustrative, not a published airline schedule.">
      Sample schedule
    </Badge>
  );
}

export function LockedBadge({ what }: { what: string }) {
  return (
    <Badge tone="premium" icon="lock" title={`${what} is locked. Keep flying to unlock it.`}>
      Locked
    </Badge>
  );
}
