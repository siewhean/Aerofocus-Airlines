import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link } from "react-router";
import "./Button.css";

type Variant = "primary" | "secondary" | "quiet" | "danger";
type Size = "md" | "lg" | "sm";

interface BaseProps {
  variant?: Variant;
  size?: Size;
  busy?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

type ButtonProps = BaseProps & ButtonHTMLAttributes<HTMLButtonElement> & { to?: undefined };
type LinkProps = BaseProps & { to: string; className?: string; "aria-label"?: string };

export function Button(props: ButtonProps | LinkProps) {
  const { variant = "secondary", size = "md", busy, icon, children } = props;
  const className = ["btn", `btn-${variant}`, `btn-${size}`, busy ? "is-busy" : "", (props as { className?: string }).className ?? ""].join(" ").trim();
  const content = (
    <>
      {icon && <span className="btn-icon" aria-hidden="true">{icon}</span>}
      {children && <span className="btn-label">{children}</span>}
    </>
  );
  if ("to" in props && props.to !== undefined) {
    return (
      <Link to={props.to} className={className} aria-label={props["aria-label"]}>
        {content}
      </Link>
    );
  }
  const { variant: _v, size: _s, busy: _b, icon: _i, children: _c, className: _cn, ...rest } = props as ButtonProps;
  return (
    <button type="button" {...rest} className={className} disabled={rest.disabled || busy} aria-busy={busy || undefined}>
      {content}
    </button>
  );
}
