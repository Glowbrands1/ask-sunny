"use client";

import * as React from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils/cn";

export interface MultiSelectOption {
  id: string;
  name: string;
}

/**
 * A searchable multi-select: type to filter, pick to add, remove from the chips.
 *
 * The list renders IN FLOW under the field rather than as a floating layer, so
 * it can never be clipped by the dialog it sits in. Chosen options leave the
 * list (no duplicates are possible), and `excludeIds` hides options that must
 * not be offered at all.
 *
 * Presentation only. It holds no state of its own beyond the search text, and
 * what it reports through `onChange` is validated again wherever it is saved.
 */
export function MultiSelect({
  id,
  options,
  value,
  onChange,
  excludeIds = [],
  disabled,
  placeholder = "Search locations…",
  emptyLabel = "No locations match.",
  noneLabel = "None selected",
}: {
  id: string;
  options: readonly MultiSelectOption[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  excludeIds?: readonly string[];
  disabled?: boolean;
  placeholder?: string;
  emptyLabel?: string;
  noneLabel?: string;
}) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const listId = `${id}-listbox`;

  const nameOf = React.useMemo(() => new Map(options.map((o) => [o.id, o.name])), [options]);

  const available = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const taken = new Set([...value, ...excludeIds]);
    return options.filter(
      (option) => !taken.has(option.id) && (!needle || option.name.toLowerCase().includes(needle)),
    );
  }, [options, value, excludeIds, query]);

  const highlighted = Math.min(active, Math.max(available.length - 1, 0));

  function add(optionId: string) {
    if (value.includes(optionId)) return;
    onChange([...value, optionId]);
    setQuery("");
    setActive(0);
  }

  function remove(optionId: string) {
    onChange(value.filter((entry) => entry !== optionId));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive(Math.min(highlighted + 1, available.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.max(highlighted - 1, 0));
    } else if (event.key === "Enter") {
      // Never submits the surrounding form: Enter here means "pick".
      event.preventDefault();
      const option = available[highlighted];
      if (open && option) add(option.id);
    } else if (event.key === "Escape") {
      if (open) {
        event.stopPropagation();
        setOpen(false);
      }
    } else if (event.key === "Backspace" && query === "" && value.length > 0) {
      remove(value[value.length - 1]!);
    }
  }

  return (
    <div
      className="space-y-2"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <ul
        aria-label="Selected locations"
        className="flex min-h-7 flex-wrap items-center gap-1.5"
        data-testid={`${id}-chips`}
      >
        {value.length === 0 ? (
          <li className="text-xs text-muted-foreground">{noneLabel}</li>
        ) : (
          value.map((optionId) => {
            const name = nameOf.get(optionId) ?? optionId;
            return (
              <li
                key={optionId}
                className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary-soft py-1 pr-1 pl-2.5 text-xs text-primary-soft-foreground"
              >
                {name}
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove ${name}`}
                  onClick={() => remove(optionId)}
                  className="inline-flex size-4 items-center justify-center rounded-full hover:bg-primary/15 disabled:cursor-not-allowed"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            );
          })
        )}
      </ul>

      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && available[highlighted] ? `${id}-opt-${available[highlighted]!.id}` : undefined}
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="h-9.5 w-full rounded-[var(--radius-sm)] border border-border-strong bg-surface px-3 text-sm text-foreground transition-[border-color,box-shadow] duration-150 placeholder:text-placeholder-foreground hover:border-[color-mix(in_srgb,var(--border-strong)_70%,var(--primary))] focus-visible:border-primary disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted-foreground"
      />

      {open && !disabled ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Available locations"
          aria-multiselectable
          className="max-h-44 overflow-y-auto rounded-[var(--radius-sm)] border border-border bg-surface py-1 text-sm"
        >
          {available.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">{emptyLabel}</li>
          ) : (
            available.map((option, index) => (
              <li
                key={option.id}
                id={`${id}-opt-${option.id}`}
                role="option"
                aria-selected={false}
                // mousedown, not click: the input must not lose focus first, or the
                // list would close before the pick registers.
                onMouseDown={(event) => {
                  event.preventDefault();
                  add(option.id);
                }}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  "cursor-pointer px-3 py-1.5 text-foreground",
                  index === highlighted && "bg-primary-soft text-primary-soft-foreground",
                )}
              >
                {option.name}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
