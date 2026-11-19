"use client";

import { Check, Loader2, Minus } from "lucide-react";

/**
 * Strong & Hanni design-system primitives used across the app. Shapes and
 * colors come from the tokens in globals.css: pills for anything pressable,
 * navy for the one primary action in a view, medium blue for interaction
 * (focus, links, active marks), semantic tints only for real state.
 */

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ Button */

type ButtonVariant = "primary" | "secondary" | "ghost" | "tinted" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-navy text-white hover:bg-navy-deep",
  secondary: "border border-line-strong bg-solid text-ink hover:bg-ice",
  ghost: "text-navy hover:bg-ice",
  tinted: "bg-ice text-navy hover:bg-ice-deep",
  danger: "bg-error text-white hover:brightness-95",
};

// md and lg meet the 44px touch minimum outright; sm extends its hit area.
const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "sh-hit-sm min-h-9 px-3.5 text-xs",
  md: "min-h-11 px-5 text-sm",
  lg: "min-h-12 px-6 text-base",
};

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  iconAfter?: React.ReactNode;
  fullWidth?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  icon,
  iconAfter,
  fullWidth = false,
  className,
  type = "button",
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold",
        "transition-[background-color,border-color,color,filter] duration-[180ms] ease-sh",
        "disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        fullWidth && "w-full",
        className
      )}
      {...props}
    >
      {icon}
      {children}
      {iconAfter}
    </button>
  );
}

/* -------------------------------------------------------------- IconButton */

type IconButtonVariant = "quiet" | "outline" | "solid";

const ICON_BUTTON_VARIANTS: Record<IconButtonVariant, string> = {
  quiet: "text-secondary hover:bg-ice hover:text-ink",
  outline: "border border-line-strong bg-solid text-ink hover:bg-ice",
  solid: "bg-navy text-white hover:bg-navy-deep",
};

const ICON_BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "sh-hit-sm h-9 w-9",
  md: "h-11 w-11",
  lg: "h-12 w-12",
};

interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** Accessible name; also shown as the tooltip. */
  label: string;
  size?: ButtonSize;
  variant?: IconButtonVariant;
  active?: boolean;
}

export function IconButton({
  label,
  size = "md",
  variant = "quiet",
  active = false,
  className,
  type = "button",
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        "flex shrink-0 items-center justify-center rounded-full",
        "transition-colors duration-[180ms] ease-sh disabled:cursor-not-allowed disabled:opacity-50",
        active ? "bg-ice-deep text-navy" : ICON_BUTTON_VARIANTS[variant],
        ICON_BUTTON_SIZES[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------- Checkbox */

export type CheckState = "checked" | "unchecked" | "indeterminate";

/** Soft-square (6px) tri-state checkbox with a navy fill. */
export function Checkbox({
  state,
  onToggle,
  className,
  label,
}: {
  state: CheckState;
  onToggle: () => void;
  className?: string;
  label?: string;
}) {
  const active = state !== "unchecked";
  return (
    <button
      type="button"
      role="checkbox"
      aria-label={label}
      title={label}
      aria-checked={state === "indeterminate" ? "mixed" : state === "checked"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cx(
        "sh-hit flex h-5 w-5 shrink-0 items-center justify-center rounded-check border",
        "transition-colors duration-[120ms] ease-sh",
        active
          ? "border-navy bg-navy text-white"
          : "border-line-strong bg-solid hover:border-blue",
        className
      )}
    >
      {state === "checked" && <Check size={13} strokeWidth={3} />}
      {state === "indeterminate" && <Minus size={13} strokeWidth={3} />}
    </button>
  );
}

/* ------------------------------------------------------------------ Switch */

/** Pill toggle for a preference that takes effect at once. */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="group inline-flex min-h-11 select-none items-center gap-3 rounded-full text-left text-sm font-medium text-ink"
    >
      <span
        className={cx(
          "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-[180ms] ease-sh",
          checked ? "bg-navy" : "bg-line-strong group-hover:bg-blue-soft"
        )}
      >
        <span
          className={cx(
            "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-solid shadow-raised",
            "transition-transform duration-[180ms] ease-sh",
            checked && "translate-x-5"
          )}
        />
      </span>
      {label}
    </button>
  );
}

/* ---------------------------------------------------------- small elements */

export function Eyebrow({
  as: Tag = "p",
  className,
  children,
}: {
  as?: "p" | "span" | "h2" | "h3";
  className?: string;
  children: React.ReactNode;
}) {
  return <Tag className={cx("sh-eyebrow", className)}>{children}</Tag>;
}

export type Tone = "neutral" | "brand" | "success" | "info" | "warning" | "error";

const BADGE_TONES: Record<Tone, string> = {
  neutral: "bg-ice text-secondary",
  brand: "bg-ice-deep text-navy",
  success: "bg-success-bg text-success",
  info: "bg-info-bg text-info",
  warning: "bg-warning-bg text-warning",
  error: "bg-error-bg text-error",
};

/** Small uppercase status pill; semantic tones report real state only. */
export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5",
        "text-micro font-semibold uppercase tracking-label",
        BADGE_TONES[tone],
        className
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cx("shrink-0 animate-spin text-blue", className)} />;
}

/* -------------------------------------------------------------- StatusBand */

const BAND_TONES: Record<Exclude<Tone, "brand">, { band: string; accent: string }> = {
  neutral: { band: "bg-ice", accent: "text-navy" },
  success: { band: "bg-success-bg", accent: "text-success" },
  info: { band: "bg-info-bg", accent: "text-info" },
  warning: { band: "bg-warning-bg", accent: "text-warning" },
  error: { band: "bg-error-bg", accent: "text-error" },
};

/** Level 4 inset band: a semantic tint strip inside a content surface. */
export function StatusBand({
  tone = "neutral",
  icon,
  title,
  action,
  className,
  children,
}: {
  tone?: Exclude<Tone, "brand">;
  icon?: React.ReactNode;
  title?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const t = BAND_TONES[tone];
  return (
    <div className={cx("flex items-start gap-3 rounded-inset p-4", t.band, className)}>
      {icon && <span className={cx("mt-0.5 shrink-0", t.accent)}>{icon}</span>}
      <div className="min-w-0 flex-1 text-sm text-ink">
        {title && <p className={cx("font-semibold", t.accent)}>{title}</p>}
        {children}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------- ProgressBar */

export function ProgressBar({
  percent,
  tone = "brand",
  size = "md",
  className,
}: {
  percent: number;
  tone?: "brand" | "success" | "error";
  size?: "sm" | "md";
  className?: string;
}) {
  const fill = tone === "error" ? "bg-error" : tone === "success" ? "bg-success" : "bg-navy";
  return (
    <div
      className={cx(
        "w-full overflow-hidden rounded-full bg-ice-deep",
        size === "sm" ? "h-1" : "h-2",
        className
      )}
    >
      <div
        className={cx("h-full rounded-full transition-[width] duration-[280ms] ease-sh", fill)}
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ Drawer */

/**
 * Transfer panel: slides in from the right over a navy-tinted scrim, inset
 * from the window edge and carrying the content curve. The scrim closes the
 * panel only when `dismissable` (never while a transfer is running).
 */
export function Drawer({
  label,
  dismissable,
  onDismiss,
  children,
}: {
  label: string;
  dismissable: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 flex justify-end sm:p-3"
      style={{ zIndex: "var(--z-drawer)" }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={dismissable ? 0 : -1}
        onClick={dismissable ? onDismiss : undefined}
        className="sh-backdrop absolute inset-0 bg-scrim"
        style={{ cursor: dismissable ? "pointer" : "default" }}
      />
      <div className="sh-drawer sh-overlay-surface relative flex h-full w-full max-w-[560px] flex-col overflow-hidden">
        {children}
      </div>
    </div>
  );
}

/** Title block of a drawer: state glyph, heading, one line of metadata, close. */
export function DrawerHeader({
  glyph,
  eyebrow,
  title,
  meta,
  action,
}: {
  glyph: React.ReactNode;
  eyebrow: string;
  title: string;
  /** Identifier line (archive name, destination), set in mono. */
  meta?: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-7 pb-5 pt-6">
      <div className="min-w-0">
        <p className="sh-eyebrow flex items-center gap-2">
          {glyph}
          {eyebrow}
        </p>
        <h2 className="mt-1.5 truncate text-xl text-ink">{title}</h2>
        {meta && <p className="mt-1 truncate font-mono text-xs text-secondary">{meta}</p>}
      </div>
      {/* Clear of the 42px corner curve. */}
      <div className="-mr-1 mt-1 shrink-0">{action}</div>
    </div>
  );
}

/** Inline "are you sure" for cancelling a running transfer. */
export function CancelConfirm({
  message,
  keepLabel,
  cancelLabel,
  onKeep,
  onCancel,
}: {
  message: string;
  keepLabel: string;
  cancelLabel: string;
  onKeep: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="px-7 pb-4">
      <StatusBand tone="warning">
        <p>{message}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" autoFocus onClick={onKeep}>
            {keepLabel}
          </Button>
          <Button variant="danger" size="sm" onClick={onCancel}>
            {cancelLabel}
          </Button>
        </div>
      </StatusBand>
    </div>
  );
}

/** "N folders · Expand all · Collapse all" bar above a grouped file list. */
export function GroupListHeader({
  label,
  onExpandAll,
  onCollapseAll,
}: {
  label: string;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-7 pb-1 pt-4">
      <Eyebrow>{label}</Eyebrow>
      <div className="-mr-3 flex items-center">
        <Button variant="ghost" size="sm" onClick={onExpandAll}>
          Expand all
        </Button>
        <Button variant="ghost" size="sm" onClick={onCollapseAll}>
          Collapse all
        </Button>
      </div>
    </div>
  );
}
