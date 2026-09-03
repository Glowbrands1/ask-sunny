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

/**
 * Pushes an arbitrary query string without moving the viewport.
 *
 * THE GENERIC FORM, and the reason it exists as its own hook: Sales Totals had
 * the scroll-jump bug that `useFilterNavigation` was written to fix, because it
 * used plain `<Link>` elements. Next scrolls to the top of the document on
 * navigation by default, so every filter click threw a reader halfway down the
 * page back to the header.
 *
 * `push` rather than `replace`, so Back undoes one filter change instead of
 * leaving the report. `startTransition` keeps the old view painted while the
 * server renders the new one, rather than blanking the page.
 */
export function useQueryNavigation(base: string) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const apply = React.useCallback(
    (params: URLSearchParams) => {
      const query = params.toString();
      startTransition(() => {
        router.push(query ? `${base}?${query}` : base, { scroll: false });
      });
    },
    [base, router],
  );

  return { apply, pending };
}

/** Pushes a new Comp Report filter state without moving the viewport. */
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

interface TriggerButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  summary: string;
  active: boolean;
  pending?: boolean;
}

/**
 * The control a filter menu hangs from.
 *
 * IT MUST FORWARD ITS REF AND SPREAD ITS PROPS, and this is not stylistic.
 * `PopoverTrigger asChild` renders a Radix `Slot`, which clones this element and
 * passes it the trigger's behaviour — `onClick`, `onPointerDown`, `type`,
 * `aria-haspopup`, `aria-expanded`, `data-state` — plus a ref used as the
 * popover's anchor. A plain function component that ignores its remaining props
 * silently swallows all of it: the button renders, looks correct, and does
 * nothing at all. That shipped once. TypeScript cannot catch it, because Slot
 * types its child as ReactNode and injects the props at runtime.
 *
 * The regression test asserts the rendered button carries `aria-haspopup`,
 * which is present only if this forwarding works.
 */
const TriggerButton = React.forwardRef<HTMLButtonElement, TriggerButtonProps>(
  ({ label, summary, active, pending, disabled, className, ...rest }, ref) => (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      className={cn(
        "flex h-9 min-w-0 items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 text-[13px] transition-colors",
        active
          // Holding a selection is a UI state, so it reads navy.
          ? "border-selected bg-selected-soft text-selected-soft-foreground"
          : "border-border-strong bg-surface text-foreground hover:bg-surface-muted",
        disabled && "cursor-default opacity-70 hover:bg-surface",
        pending && "opacity-60",
        className,
      )}
      {...rest}
    >
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate font-medium">{summary}</span>
      {disabled ? null : <ChevronDown aria-hidden className="size-3.5 shrink-0 opacity-60" />}
    </button>
  ),
);
TriggerButton.displayName = "TriggerButton";

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

/**
 * One row in a menu.
 *
 * `mode` decides the indicator, and it is not decoration. A multi-select row is
 * a checkbox: several can be on, and an empty box is meaningful. A single-select
 * row is a radio: exactly one is on, and a row of empty boxes reads as "nothing
 * is selected" when in fact something always is. That confusion is exactly what
 * the Window control was reported for.
 */
function OptionRow({
  checked,
  label,
  note,
  reason,
  unavailable,
  mode,
  onSelect,
}: {
  checked: boolean;
  label: React.ReactNode;
  note?: React.ReactNode;
  /** Why this option cannot show anything. Rendered under the label. */
  reason?: string | null;
  /** Selectable, but the report holds no figure for it. Said, never hidden. */
  unavailable?: boolean;
  mode: "single" | "multi";
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role={mode === "single" ? "menuitemradio" : "menuitemcheckbox"}
      aria-checked={checked}
      onClick={onSelect}
      className="flex w-full items-start gap-2 px-3 py-1.5 text-left text-[13px] text-foreground transition-colors hover:bg-surface-muted"
    >
      {mode === "single" ? (
        // A tick in a fixed-width slot, so labels stay aligned whether or not
        // the row is the selected one.
        <span
          aria-hidden
          className={cn(
            "flex w-4 shrink-0 justify-center pt-0.5",
            checked ? "text-selected" : "text-transparent",
          )}
        >
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      ) : (
        <span
          aria-hidden
          className={cn(
            "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
            checked
              ? "border-selected bg-selected text-selected-foreground"
              : "border-border-strong bg-surface",
          )}
        >
          {checked ? <Check className="size-3" strokeWidth={3} /> : null}
        </span>
      )}

      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate",
            checked && mode === "single" && "font-medium",
            unavailable && "text-muted-foreground",
          )}
        >
          {label}
        </span>
        {/* An unavailable option explains itself. Hiding it looks like a missing
            feature; fabricating a chart for it would be worse. */}
        {reason ? (
          <span className="mt-0.5 block text-[11px] leading-snug text-subtle-foreground">
            {reason}
          </span>
        ) : null}
      </span>

      {note ? (
        <span className="shrink-0 pt-0.5 text-xs text-muted-foreground">{note}</span>
      ) : null}
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
  /** Why it holds nothing. Shown under the label when present. */
  reason?: string | null;
}

/**
 * The body of a multi-select: header actions, then rows.
 *
 * Shared by the popover form and the inline form, because the `More` panel must
 * NOT nest a popover inside a popover. Radix portals the inner layer, and a
 * pointer-down inside it is not reliably treated as inside the outer layer — so
 * the nested version collapsed the panel the moment you ticked anything. The
 * fix is structural: one implementation, rendered inline where nesting would
 * otherwise happen.
 *
 * `Select all` and the reset action operate on what the search box currently
 * shows, so searching "Bowen" and pressing Select all selects those and nothing
 * else — the alternative silently selects rows the user cannot see.
 */
function MultiSelectBody({
  label,
  options,
  selected,
  onChange,
  searchable,
  searchPlaceholder,
  footnote,
  clearLabel = "Clear",
  maxHeight = "max-h-72",
}: {
  label: string;
  options: MenuOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** A line under the rows explaining why the list is as short as it is. */
  footnote?: string;
  /**
   * What emptying the selection is CALLED, because that differs by caller.
   *
   * The action always does the same thing — `onChange([])` — but what an empty
   * selection MEANS is the caller's business, and the word has to match it. In
   * Sales Totals an empty selection is every salon in the delivery, so "Clear"
   * described the mechanism and contradicted the result: pressing it widens the
   * dashboard to all fifteen salons. Callers whose empty state genuinely means
   * "no filter applied" keep the default.
   *
   * A LABEL ONLY. No caller can change what the action does through this prop.
   */
  clearLabel?: string;
  maxHeight?: string;
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

  const visibleValues = visible.map((option) => option.value);
  const allVisibleSelected =
    visibleValues.length > 0 && visibleValues.every((value) => selected.includes(value));

  return (
    <>
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
            onClick={() => onChange([...new Set([...selected, ...visibleValues])])}
            disabled={allVisibleSelected}
          >
            Select all
          </MenuAction>
          <MenuAction onClick={() => onChange([])} disabled={selected.length === 0}>
            {clearLabel}
          </MenuAction>
        </span>
      </MenuHeader>

      <div
        className={cn("scroll-slim overflow-y-auto py-1", maxHeight)}
        role="group"
        aria-label={label}
      >
        {visible.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            Nothing matches “{query}”.
          </p>
        ) : (
          visible.map((option) => (
            <OptionRow
              key={option.value}
              mode="multi"
              checked={selected.includes(option.value)}
              label={option.label}
              note={option.note}
              onSelect={() => onChange(toggled(selected, option.value))}
            />
          ))
        )}
      </div>

      {/* Why this list is the length it is. A four-row Salon menu in a
          fifteen-salon report looks like a bug unless the menu says that a
          district filter above is narrowing it. */}
      {footnote ? (
        <p className="border-t border-border px-3 py-1.5 text-[11px] leading-snug text-subtle-foreground">
          {footnote}
        </p>
      ) : null}
    </>
  );
}

/** A multi-select facet, as a dropdown. */
export function MultiSelectMenu({
  label,
  options,
  selected,
  onChange,
  searchable,
  searchPlaceholder,
  footnote,
  pending,
  emptyLabel = "All",
  clearLabel,
}: {
  label: string;
  options: MenuOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** A line under the rows explaining why the list is as short as it is. */
  footnote?: string;
  pending?: boolean;
  /** Shown on the trigger when nothing is selected. */
  emptyLabel?: string;
  /**
   * What emptying the selection is called. Defaults to "Clear"; a caller whose
   * empty selection means "everything" should name it accordingly. See
   * `MultiSelectBody`.
   */
  clearLabel?: string;
}) {
  const summary =
    selected.length === 0
      ? emptyLabel
      : selected.length === 1
        ? (options.find((option) => option.value === selected[0])?.label ?? selected[0])
        : `${selected.length} selected`;

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
        <MultiSelectBody
          label={label}
          options={options}
          selected={selected}
          onChange={onChange}
          searchable={searchable}
          searchPlaceholder={searchPlaceholder}
          footnote={footnote}
          clearLabel={clearLabel}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The same multi-select, rendered in place.
 *
 * Used inside the `More` panel, which is itself a popover — see the note on
 * `MultiSelectBody` for why nesting one popover in another was not an option.
 */
export function InlineMultiSelect({
  label,
  options,
  selected,
  onChange,
  hint,
  clearLabel,
}: {
  label: string;
  options: MenuOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  hint?: string;
  /** What emptying the selection is called. See `MultiSelectBody`. */
  clearLabel?: string;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-sm)] border border-border">
      <div className="flex items-baseline justify-between gap-2 bg-surface-muted px-3 py-1.5">
        <p className="text-xs font-medium text-foreground">{label}</p>
        {hint ? <p className="text-[11px] text-subtle-foreground">{hint}</p> : null}
      </div>
      <MultiSelectBody
        label={label}
        options={options}
        selected={selected}
        onChange={onChange}
        clearLabel={clearLabel}
        maxHeight="max-h-44"
      />
    </div>
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
  emptyLabel = "—",
}: {
  label: string;
  options: MenuOption[];
  selected: string | null;
  onChange: (value: string) => void;
  pending?: boolean;
  /** Optional grouping, e.g. metric family. Values must cover every option. */
  groups?: { key: string; label: string; values: string[] }[];
  /**
   * Shown on the trigger when nothing is selected.
   *
   * A dash is right where "nothing selected" is a transient state and wrong
   * where it is a legitimate one — a reader cannot tell a control with no
   * selection from a control that failed to resolve, which is exactly how the
   * Window control's `—` was read. A control whose empty state is meaningful
   * should name it.
   */
  emptyLabel?: string;
}) {
  const summary = options.find((option) => option.value === selected)?.label ?? emptyLabel;
  const single = options.length <= 1;

  const rows = (subset: MenuOption[]) =>
    subset.map((option) => (
      <OptionRow
        key={option.value}
        mode="single"
        checked={option.value === selected}
        label={option.label}
        note={option.unavailable && !option.reason ? "not reported" : option.note}
        reason={option.reason}
        unavailable={option.unavailable}
        onSelect={() => onChange(option.value)}
      />
    ));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <TriggerButton
          label={label}
          summary={summary}
          active={false}
          pending={pending}
          // A ONE-OPTION CONTROL IS STILL A REAL CONTROL. It used to render as a
          // flat label, which hid where future options will appear: opening
          // Period and seeing one dated report is how a manager learns that more
          // will simply show up there as they are loaded.
          title={single ? `${label}: only one option is loaded so far` : undefined}
        />
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
