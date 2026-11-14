"use client";
// Copied from the Leadership Hub (src/components/Mentions.tsx); keep in step with it. See src/features/l10/README.md.

import { createPortal } from "react-dom";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";
import { cx, inputClass } from "@/features/l10/ui/ui";
import { activeTrigger, filterPeople, fromDisplay, makeToken, mentionsToText, splitMentions, toDisplay, type Person } from "@/features/l10/lib/mentions";

/** The people who can open this meeting (the only people the picker offers). Empty means no picker. */
const RosterContext = createContext<readonly Person[]>([]);
export const MentionRoster = RosterContext.Provider;
export const useMentionRoster = () => useContext(RosterContext);

/** Read-only text with mentions as name chips. Unknown ids stay plain text. Everything is escaped by React. */
export function MentionText({ text, people }: { text: string; people?: readonly Person[] }) {
  const fromContext = useMentionRoster();
  const roster = people ?? fromContext;
  const segments = useMemo(() => splitMentions(text, roster), [text, roster]);
  return (
    <>
      {segments.map((s, i) =>
        s.type === "text" ? (
          <span key={i}>{s.text}</span>
        ) : s.known ? (
          <span key={i} data-mention="" className="rounded bg-sunny px-1 font-semibold text-ink print:bg-transparent print:px-0 print:underline">
            @{s.name}
          </span>
        ) : (
          <span key={i}>@{s.name}</span>
        ),
      )}
    </>
  );
}

/** Plain-text version for labels. */
export function useMentionPlain() {
  const roster = useMentionRoster();
  return useCallback((text: string) => mentionsToText(text, roster), [roster]);
}

type FieldProps = Omit<ComponentProps<"input">, "value" | "onChange" | "ref"> & {
  value: string;
  onChange: (next: string) => void;
  multiline?: boolean;
  /** Overrides the meeting's roster (tests). */
  people?: readonly Person[];
  /** Classes for the wrapper, which is the flex item in a row (size it here; `className` styles the field itself). */
  wrapperClassName?: string;
};

/**
 * A text field where typing "@" offers the people of this meeting (an ARIA combobox: arrow keys, Enter to pick,
 * Escape to close, type to filter; a bottom sheet with 44 px rows on phones). The stored text holds a token
 * `@[Name|id]`; while editing the field shows a plain "@Name". With no roster it is a plain field.
 * Enter only picks when a person has been highlighted with the arrow keys, so an ordinary Enter (for example
 * "add this to-do") behaves exactly as before.
 */
export function MentionField({ value, onChange, multiline = false, people, className, wrapperClassName, onKeyDown, onBlur, ...rest }: FieldProps) {
  const fromContext = useMentionRoster();
  const roster = people ?? fromContext;
  const listId = useId();
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(-1);
  const [lift, setLift] = useState(0);
  // Where the list sits on a computer: just under the field (or above it when there is more room there), in a layer of its own so no
  // card, table or panel around the field can clip it (rocks sit inside boxes that hide anything outside them).
  const [place, setPlace] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null);

  const display = toDisplay(value, roster);
  const matches = trigger && roster.length ? filterPeople(roster, trigger.query) : [];
  const open = matches.length > 0;

  useLayoutEffect(() => {
    if (pendingCaret.current !== null && ref.current) {
      ref.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  // On a phone the list sits above the on-screen keyboard.
  useEffect(() => {
    if (!open || typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const update = () => setLift(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const below = window.innerHeight - r.bottom;
      const above = r.top;
      setPlace(below < 240 && above > below ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 4 } : { left: r.left, width: r.width, top: r.bottom + 4 });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, display]);

  const close = () => {
    setTrigger(null);
    setActive(-1);
  };

  const handleChange = (text: string, caret: number) => {
    // A disabled field (for example an old, read-only version of a meeting) never edits or opens the picker.
    if (ref.current?.matches(":disabled")) return;
    onChange(fromDisplay(text, value, roster));
    const t = roster.length ? activeTrigger(text, caret) : null;
    setTrigger(t);
    setActive(-1);
  };

  const pick = (p: Person) => {
    if (!trigger) return;
    const caret = trigger.start + 1 + trigger.query.length;
    const shown = `${display.slice(0, trigger.start)}@${p.name} ${display.slice(caret)}`;
    onChange(fromDisplay(shown, value, roster, [p.id]));
    pendingCaret.current = trigger.start + 1 + p.name.length + 1;
    close();
    ref.current?.focus();
  };

  const keys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => (a + 1) % matches.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => (a <= 0 ? matches.length - 1 : a - 1));
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && active >= 0) {
        e.preventDefault();
        pick(matches[active]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
    }
    onKeyDown?.(e);
  };

  const common = {
    ref,
    value: display,
    role: roster.length ? ("combobox" as const) : undefined,
    "aria-autocomplete": roster.length ? ("list" as const) : undefined,
    "aria-expanded": roster.length ? open : undefined,
    "aria-controls": open ? listId : undefined,
    "aria-activedescendant": open && active >= 0 ? `${listId}-${active}` : undefined,
    className: cx(inputClass, className),
    onKeyDown: keys,
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
      // A pick uses mousedown on an option, which keeps focus here; a real blur closes the list.
      close();
      onBlur?.(e);
    },
  };

  return (
    <span className={cx("relative block min-w-0 flex-1", wrapperClassName)}>
      {multiline ? (
        <textarea
          {...(rest as ComponentProps<"textarea">)}
          {...(common as unknown as ComponentProps<"textarea">)}
          onChange={(e) => handleChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        />
      ) : (
        <input {...rest} {...common} onChange={(e) => handleChange(e.target.value, e.target.selectionStart ?? e.target.value.length)} />
      )}
      {open && typeof document !== "undefined" &&
        createPortal(
          <ul
            id={listId}
            role="listbox"
            data-bottom-sheet
            aria-label="People you can mention"
            style={
              {
                bottom: lift ? `${lift}px` : undefined,
                "--mx-left": `${place?.left ?? 0}px`,
                "--mx-width": `${Math.max(place?.width ?? 0, 220)}px`,
                "--mx-top": place?.top !== undefined ? `${place.top}px` : "auto",
                "--mx-bottom": place?.bottom !== undefined ? `${place.bottom}px` : "auto",
              } as React.CSSProperties
            }
            className="fixed z-50 m-0 max-h-56 list-none overflow-auto rounded-[10px] border border-line bg-white p-1 shadow-lg sm:top-[var(--mx-top)] sm:bottom-[var(--mx-bottom)] sm:left-[var(--mx-left)] sm:w-[var(--mx-width)] max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[50vh] max-sm:rounded-b-none max-sm:rounded-t-xl max-sm:p-2"
          >
            {matches.map((p, i) => (
              <li
                key={p.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                className={cx("flex min-h-11 cursor-pointer items-center rounded-lg px-3 text-sm", i === active ? "bg-ink text-gold" : "hover:bg-cream")}
              >
                {p.name}
              </li>
            ))}
          </ul>,
          document.body,
        )}
      <span className="sr-only" role="status" aria-live="polite">
        {trigger && roster.length ? (matches.length ? `${matches.length} ${matches.length === 1 ? "person matches" : "people match"}` : "No one matches") : ""}
      </span>
    </span>
  );
}

export { makeToken };
