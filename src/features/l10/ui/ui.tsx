"use client";
// Copied from the Leadership Hub (src/components/ui.tsx); keep in step with it. See src/features/l10/README.md.

import Link from "next/link";
import { useEffect, useId, useRef, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { twMerge } from "tailwind-merge";

/** Join class names; later Tailwind utilities override earlier conflicting ones. */
function cx(...classes: (string | false | null | undefined)[]) {
  return twMerge(classes.filter(Boolean).join(" "));
}
export { cx };

/* ── Surfaces ─────────────────────────────────────────────── */

export const cardClass = "glass";

/** Floating glass card. Pass `hover` for clickable or summary cards (not big forms or tables). */
export function Card({ className, hover, ...props }: ComponentProps<"section"> & { hover?: boolean }) {
  return <section className={cx(cardClass, "p-5", hover && "glass-hover", className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cx("m-0 text-base font-bold tracking-tight text-balance", className)} {...props} />;
}

/** Ink header row used by every data table. Solid ink, frosted where backdrop-filter is supported. */
export const tableHeadClass =
  "bg-ink text-[11px] font-semibold tracking-[0.1em] text-gold-head supports-[backdrop-filter]:bg-ink/85 supports-[backdrop-filter]:backdrop-blur-md";

/** Shared table styling: sticky ink head, soft zebra rows, sunny hover, hairline cell borders. */
export const tableClass = cx(
  "w-full border-separate border-spacing-0 text-left text-sm",
  "[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10",
  "[&_:is(th,td)]:px-4 [&_:is(th,td)]:py-3 [&_:is(th,td)]:first:pl-5 [&_:is(th,td)]:last:pr-5 [&_th]:text-left",
  "[&_thead_th]:font-semibold [&_thead_th]:whitespace-nowrap [&_tbody_th]:font-semibold",
  "[&_tbody_:is(th,td)]:border-t [&_tbody_:is(th,td)]:border-line/50",
  "[&_tbody>tr:nth-child(odd)]:bg-white/30 [&_tbody>tr]:transition-colors [&_tbody>tr:hover]:bg-sunny/70",
);

/** Right-aligned tabular numbers for table cells and headers (wins over the table's left alignment). */
export const numClass = "text-right! font-mono tabular-nums";

export function Eyebrow({ className, ...props }: ComponentProps<"div">) {
  return <div className={cx("text-xs font-bold tracking-[0.12em] text-bronze-deep", className)} {...props} />;
}

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h1 className={cx("m-0 text-[28px] leading-tight font-bold tracking-tight text-balance", eyebrow && "mt-1")}>{title}</h1>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </header>
  );
}

/** Tiny trend line for KPI cards. Purely decorative; the label describes it for screen readers. */
export function Sparkline({ values, label, className }: { values: number[]; label?: string; className?: string }) {
  if (values.length < 2) return null;
  const w = 88;
  const h = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={cx("h-7 w-[88px] shrink-0 overflow-visible", className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={d} fill="none" stroke="var(--color-gold)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r="2.5" fill="var(--color-bronze)" />
    </svg>
  );
}

export function KpiCard({
  label,
  value,
  testId,
  sparkline,
  sparklineLabel,
  note,
}: {
  label: string;
  value: string;
  testId?: string;
  /** Small caption beside the label, e.g. "Sample figures". */
  note?: string;
  /** Optional series (oldest → newest) drawn as a tiny trend line. */
  sparkline?: number[];
  sparklineLabel?: string;
}) {
  return (
    <div className={cx(cardClass, "glass-hover relative overflow-hidden p-4 pt-[18px]")} data-testid={testId}>
      <span aria-hidden className="absolute inset-x-6 top-0 h-0.5 bg-gradient-to-r from-transparent via-gold to-transparent" />
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-[0.1em] text-muted uppercase">{label}</span>
        {note && <span className="text-[11px] text-muted">{note}</span>}
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-3">
        <div className="font-mono text-[28px] leading-none font-medium tracking-tight tabular-nums">{value}</div>
        {sparkline && <Sparkline values={sparkline} label={sparklineLabel} />}
      </div>
    </div>
  );
}

/* ── Tabs ─────────────────────────────────────────────────── */

/** Pill tab bar: role=tablist, roving tabindex, arrow/Home/End keys. Scrolls sideways on narrow screens. */
export function PillTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix,
  className,
}: {
  tabs: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
  /** When set, tabs get ids `${idPrefix}-tab-${id}` and point at panels `${idPrefix}-panel-${id}`. */
  idPrefix?: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  }

  return (
    <div className={cx("max-w-full overflow-x-auto [scrollbar-width:none]", className)}>
      <div role="tablist" aria-label={label} className={cx(cardClass, "inline-flex gap-1 rounded-full p-1.5")}>
        {tabs.map((t, i) => {
          const selected = t.id === value;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={idPrefix ? `${idPrefix}-tab-${t.id}` : undefined}
              aria-controls={idPrefix ? `${idPrefix}-panel-${t.id}` : undefined}
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cx(
                "inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold whitespace-nowrap transition-colors sm:px-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze",
                selected ? "bg-ink/90 text-gold-head" : "text-ink hover:bg-white/70",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Empty state ──────────────────────────────────────────── */

export function EmptyState({
  children,
  action,
  icon,
  className,
}: {
  children: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("glass-tile flex flex-wrap items-center gap-3 px-4 py-3.5 text-sm text-muted", className)}>
      <span aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-sunny text-bronze-deep">
        {icon ?? (
          <svg viewBox="0 0 16 16" className="size-4">
            <path d="M3 4.5h10M3 8h10M3 11.5h6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  );
}

/* ── Status badges ────────────────────────────────────────── */

export type Tone = "ok" | "warn" | "bad";

const TONE_CLASS: Record<Tone, string> = {
  ok: "bg-ok text-[#111111]",
  warn: "bg-warn text-warn-ink",
  bad: "bg-bad text-[#111111]",
};

export const STATUS_TONE: Record<string, Tone> = {
  Current: "ok",
  "Due soon": "warn",
  Overdue: "bad",
  "On track": "ok",
  "At risk": "warn",
  "Off track": "bad",
  Done: "ok",
  Active: "ok",
  "Notice soon": "warn",
  Expiring: "bad",
};

export function Badge({ children, tone, className, ...props }: ComponentProps<"span"> & { tone?: Tone }) {
  const t = tone ?? STATUS_TONE[String(children)] ?? "ok";
  return (
    <span
      className={cx(
        "inline-flex items-center justify-self-start rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap ring-1 ring-ink/10",
        TONE_CLASS[t],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/** A status badge that cycles through `options` when clicked. */
export function StatusToggle<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly T[];
  onChange: (next: T) => void;
  label: string;
}) {
  const next = options[(options.indexOf(value) + 1) % options.length];
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      title={`Change to ${next}`}
      aria-label={`${label}: ${value}. Change to ${next}`}
      className={cx(
        "relative inline-flex min-h-8 items-center rounded-full px-3 py-1 text-xs font-bold whitespace-nowrap ring-1 after:absolute after:-inset-1.5 after:content-[''] ring-ink/10 transition hover:ring-2 hover:ring-gold/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze",
        TONE_CLASS[STATUS_TONE[value] ?? "ok"],
      )}
    >
      {value}
    </button>
  );
}

/* ── Buttons ──────────────────────────────────────────────── */

const BUTTON_BASE =
  "inline-flex min-h-11 items-center justify-center rounded-xl px-[18px] text-sm font-semibold whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze disabled:cursor-not-allowed disabled:opacity-60";

const GLASS_BUTTON = "border border-white/70 bg-white/60 ring-1 ring-white/60 shadow-[inset_0_1px_0_rgb(255_255_255/0.9)] hover:bg-white/85";

const BUTTON_VARIANT = {
  primary:
    "bg-bronze text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_8px_20px_-8px_rgb(138_106_15/0.6)] hover:bg-[#755a0c]",
  secondary: GLASS_BUTTON,
  outline: cx(GLASS_BUTTON, "px-3.5 text-[13px]"),
  link: "min-h-0 px-0 text-[13px] text-bronze-deep hover:underline",
} as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANT;

export function Button({ variant = "secondary", className, ...props }: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return <button type="button" className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], className)} {...props} />;
}

export function ButtonLink({ variant = "secondary", className, ...props }: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link className={cx(BUTTON_BASE, BUTTON_VARIANT[variant], className)} {...props} />;
}

/* ── Filter chips (white select styled like the design's chips) ─ */

export function ChipSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "md",
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <span className="relative inline-flex">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={cx(
          "appearance-none rounded-xl border border-white/70 bg-white/70 pr-8 pl-3.5 text-sm font-medium text-ink ring-1 ring-line/60 transition hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bronze",
          size === "sm" ? "min-h-11" : "min-h-11 pl-4",
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg aria-hidden viewBox="0 0 12 12" className="pointer-events-none absolute top-1/2 right-3 size-2.5 -translate-y-1/2 text-muted">
        <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/* ── Forms ────────────────────────────────────────────────── */

export const inputClass =
  "min-h-11 w-full min-w-0 rounded-xl border border-white/70 bg-white/70 px-3 font-sans text-sm text-ink ring-1 ring-line/60 transition placeholder:text-muted/80 hover:bg-white/85 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-bronze/50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-bronze disabled:opacity-60";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-muted">
      {label}
      {children}
    </label>
  );
}

/* ── Modal ────────────────────────────────────────────────── */

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    // Lock the page behind the dialog; restore whatever it had on close.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = panelRef.current;
    const focusable = panel?.querySelector<HTMLElement>("input, select, textarea, button:not([data-close])");
    (focusable ?? panel)?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
      // Keep Tab focus inside the dialog.
      if (e.key === "Tab" && panel) {
        const items = [...panel.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter(
          (el) => !el.hasAttribute("disabled"),
        );
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  // Portal to <body>: glass cards use backdrop-filter, which would otherwise trap a fixed overlay inside the card.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-ink/40 p-4 pt-[10vh] backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className={cx(cardClass, "flex w-full max-w-[520px] flex-col gap-4 rounded-3xl p-6 outline-none supports-[backdrop-filter]:bg-white/80")}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="m-0 text-lg font-bold">
            {title}
          </h2>
          <button
            type="button"
            data-close
            onClick={onClose}
            aria-label="Close"
            className="-mt-1.5 -mr-2.5 inline-flex size-11 items-center justify-center rounded-xl text-muted hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-bronze"
          >
            <svg aria-hidden viewBox="0 0 12 12" className="size-3">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {children}
        {footer && <div className="flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
