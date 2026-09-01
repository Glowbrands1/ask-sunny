"use client";

import * as React from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { Input } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { cn } from "@/lib/utils/cn";
import { serializeReportFilters, type ReportFilters } from "@/lib/reporting/read/filters";

/**
 * THE FILTER CONTROLS.
 *
 * Two things about these are deliberate and easy to undo by accident.
 *
 * 1. FILTER STATE STAYS IN THE URL. These are client components only so they can
 *    open a panel and call the router; the selection itself is never held in
 *    React state. That is what keeps a pasted link reproducing exactly what
 *    somebody was looking at, keeps refresh honest, and keeps the server the one
 *    place that decides what the numbers are.
 *
 * 2. NAVIGATION USES `scroll: false`. The dashboard is taller than a screen, and
 *    the previous version navigated with plain links — so ticking a salon
 *    halfway down the page threw the reader back to the header, every time. The
 *    router call below is the fix, and it is a `push` rather than a `replace` on
 *    purpose: Back then undoes one filter change instead of leaving the page.
 *
 * A POPOVER, NOT A DROPDOWN MENU. A menu closes when an item is activated, which
 * is right for a command and wrong for a multi-select: ticking six salons would
 * mean opening the menu six times.
 */

/** Pushes a new filter state without moving the viewport. */
export function useFilterNavigation(base: string) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = React.useTransition();

  const apply = React.useCallback(
    (next: ReportFilters) => {
      const query = serializeReportFilters(next).toString();
      const target = query ? `${base}?${query}` : base;
      startTransition(() => {
        // `scroll: false` is the whole point — see the note above.
        router.push(target, { scroll: false });
      });
    },
    [base, router],
  );

  return { apply, pending, pathname };
}

/** Adds or removes one value from a multi-select facet. */
export function toggled(values: readonly string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

function TriggerButton({
  label,
  summary,
  active,
  pending,
  disabled,
}: {
  label: string;
  summary: string;
  active: boolean;
  pending?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "flex h-9 min-w-0 items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 text-[13px] transition-colors",
        active
          ? "border-primary bg-primary-soft text-primary-soft-foreground"
          : "border-border-strong bg-surface text-foreground hover:bg-surface-muted",
        disabled && "cursor-default opacity-70 hover:bg-surface",
        pending && "opacity-60",
      )}
    >
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{summary}</span>
      {disabled ? null : <ChevronDown aria-hidden className="size-3.5 shrink-0 opacity-60" />}
    </button>
  );
}

function MenuHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function MenuAction({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-[var(--radius-xs)] px-1.5 py-0.5 text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:no-underline"
    >
      {children}
    </button>
  );
}

/** One row in a menu: a tick, a label, and an optional right-hand note. */
function OptionRow({
  checked,
  label,
  note,
  unavailable,
  onSelect,
}: {
  checked: boolean;
  label: React.ReactNode;
  note?: React.ReactNode;
  /** Selectable, but the report holds no figure for it. Said, never hidden. */
  unavailable?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onSelect}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-surface-muted"
    >
      {/* A real tick, not a colour change: the checkmark is the state. */}
      <span
        aria-hidden
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
          checked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border-strong bg-surface",
        )}
      >
        {checked ? <Check className="size-3" strokeWidth={3} /> : null}
      </span>
      <span className={cn("min-w-0 flex-1 truncate", unavailable && "text-muted-foreground")}>
        {label}
      </span>
      {note ? <span className="shrink-0 text-xs text-muted-foreground">{note}</span> : null}
    </button>
  );
}

export interface MenuOption {
  value: string;
  label: string;
  /** Right-hand note, e.g. a salon count. */
  note?: string;
  /** Extra text matched by the search box. */
  searchText?: string;
  /** True when the report holds nothing for this option. Marked, not removed. */
  unavailable?: boolean;
}

/**
 * A multi-select facet menu.
 *
 * `Select all` and `Clear` operate on what the search box currently shows, so
 * searching "Bowen" and pressing Select all selects those and nothing else —
 * the alternative silently selects rows the user cannot see.
 */
export function MultiSelectMenu({
  label,
  options,
  selected,
  onChange,
  searchable,
  searchPlaceholder,
  pending,
  emptyLabel = "All",
}: {
  label: string;
  options: MenuOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  pending?: boolean;
  /** Shown on the trigger when nothing is selected. */
  emptyLabel?: string;
}) {
  const [query, setQuery] = React.useState("");

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        option.value.toLowerCase().includes(needle) ||
        (option.searchText ?? "").toLowerCase().includes(needle),
    );
  }, [options, query]);

  const summary =
    selected.length === 0
      ? emptyLabel
      : selected.length === 1
        ? (options.find((option) => option.value === selected[0])?.label ?? selected[0])
        : `${selected.length} selected`;

  const visibleValues = visible.map((option) => option.value);
  const allVisibleSelected =
    visibleValues.length > 0 && visibleValues.every((value) => selected.includes(value));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <TriggerButton
          label={label}
          summary={summary}
          active={selected.length > 0}
          pending={pending}
        />
      </PopoverTrigger>
      <PopoverContent className="w-72">
        {searchable ? (
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder ?? `Search ${label.toLowerCase()}`}
                className="h-8 pl-8 text-[13px]"
                aria-label={`Search ${label.toLowerCase()}`}
              />
            </div>
          </div>
        ) : null}

        <MenuHeader>
          <span>
            {selected.length === 0
              ? `${options.length} available`
              : `${selected.length} of ${options.length} selected`}
          </span>
          <span className="flex items-center gap-1">
            <MenuAction
              onClick={() =>
                onChange([...new Set([...selected, ...visibleValues])])
              }
              disabled={allVisibleSelected}
            >
              Select all
            </MenuAction>
            <MenuAction onClick={() => onChange([])} disabled={selected.length === 0}>
              Clear
            </MenuAction>
          </span>
        </MenuHeader>

        <div className="scroll-slim max-h-72 overflow-y-auto py-1" role="group" aria-label={label}>
          {visible.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              Nothing matches “{query}”.
            </p>
          ) : (
            visible.map((option) => (
              <OptionRow
                key={option.value}
                checked={selected.includes(option.value)}
                label={option.label}
                note={option.note}
                onSelect={() => onChange(toggled(selected, option.value))}
              />
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A single-select menu.
 *
 * Options the report cannot satisfy stay listed and stay selectable, marked
 * "not reported". Hiding them would make the menu change shape as the measure
 * changes; selecting one shows "Unavailable" in the view, which is the honest
 * answer and teaches the shape of the data. Nothing is ever substituted.
 */
export function SingleSelectMenu({
  label,
  options,
  selected,
  onChange,
  pending,
  groups,
}: {
  label: string;
  options: MenuOption[];
  selected: string | null;
  onChange: (value: string) => void;
  pending?: boolean;
  /** Optional grouping, e.g. metric family. Values must cover every option. */
  groups?: { key: string; label: string; values: string[] }[];
}) {
  const summary = options.find((option) => option.value === selected)?.label ?? "—";
  const single = options.length <= 1;

  const rows = (subset: MenuOption[]) =>
    subset.map((option) => (
      <OptionRow
        key={option.value}
        checked={option.value === selected}
        label={option.label}
        note={option.unavailable ? "not reported" : option.note}
        unavailable={option.unavailable}
        onSelect={() => onChange(option.value)}
      />
    ));

  if (single) {
    // A control that cannot change anything invites a click and then looks
    // broken, so it renders as a plain label instead of a dead dropdown.
    return <TriggerButton label={label} summary={summary} active={false} disabled />;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <TriggerButton label={label} summary={summary} active={false} pending={pending} />
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="scroll-slim max-h-80 overflow-y-auto py-1" role="group" aria-label={label}>
          {groups
            ? groups.map((group) => {
                const subset = options.filter((option) => group.values.includes(option.value));
                if (subset.length === 0) return null;
                return (
                  <div key={group.key}>
                    <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">
                      {group.label}
                    </p>
                    {rows(subset)}
                  </div>
                );
              })
            : rows(options)}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A panel of secondary facets, so they do not compete with the main controls. */
export function MoreFiltersMenu({
  activeCount,
  children,
}: {
  activeCount: number;
  children: React.ReactNode;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <TriggerButton
          label="More"
          summary={activeCount > 0 ? `${activeCount} applied` : "Filters"}
          active={activeCount > 0}
        />
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="scroll-slim max-h-[70vh] space-y-3 overflow-y-auto p-3">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
