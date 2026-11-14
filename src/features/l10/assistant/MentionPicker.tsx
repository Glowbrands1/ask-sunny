// Copied from the Leadership Hub (src/components/assistant/MentionPicker.tsx); keep in step with it. See src/features/l10/README.md.
"use client";

import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/features/l10/ui/ui";
import { activeTrigger, filterPeople } from "@/features/l10/lib/mentions";
import { insertMention, splitChatMentions, type Person } from "./chat-mentions";

/** The people the chat can @-mention. Ask Sunny: this meeting's people only (the Hub: everyone the person shares a meeting with). */
const PeopleContext = createContext<readonly Person[]>([]);
export const ChatPeople = PeopleContext.Provider;
export const useChatPeople = () => useContext(PeopleContext);

/**
 * "@" in the chat box: offers the people from the signed-in person's meetings, filtered as they type (an ARIA
 * combobox). The first match is highlighted, so Enter or Tab picks it; arrows move; Escape closes; a click or tap
 * picks. Picking writes "@Full Name " into the box. While the list is closed every key behaves as before (Enter sends).
 */
export function useMentionPicker({
  people,
  text,
  setText,
  inputRef,
}: {
  people: readonly Person[];
  text: string;
  setText: (next: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const listId = useId();
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  const pendingCaret = useRef<number | null>(null);
  const matches = trigger && people.length ? filterPeople(people, trigger.query) : [];
  const open = matches.length > 0;

  useLayoutEffect(() => {
    if (pendingCaret.current !== null && inputRef.current) {
      inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  const update = (el: HTMLTextAreaElement) => {
    // Tracked even before the people have loaded, so an "@" typed straight away opens the list as soon as they arrive.
    setTrigger(activeTrigger(el.value, el.selectionStart ?? el.value.length));
    setActive(0);
  };
  const close = () => setTrigger(null);
  const pick = (p: Person) => {
    if (!trigger) return;
    const next = insertMention(text, trigger, p.name);
    pendingCaret.current = next.caret;
    setText(next.text);
    close();
    inputRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (e.key === "ArrowDown" ? (a + 1) % matches.length : a <= 0 ? matches.length - 1 : a - 1));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault(); // picks instead of sending
      pick(matches[Math.max(0, active)]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  const inputProps = {
    role: people.length ? ("combobox" as const) : undefined,
    "aria-autocomplete": people.length ? ("list" as const) : undefined,
    "aria-expanded": people.length ? open : undefined,
    "aria-controls": open ? listId : undefined,
    "aria-activedescendant": open ? `${listId}-${active}` : undefined,
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => update(e.target),
    onSelect: (e: React.SyntheticEvent<HTMLTextAreaElement>) => trigger && update(e.currentTarget),
    onKeyDown,
    onBlur: close,
  };

  const list = open ? <PeopleList id={listId} people={matches} active={active} onPick={pick} anchor={inputRef} /> : null;
  return { inputProps, list, open };
}

function PeopleList({ id, people, active, onPick, anchor }: { id: string; people: Person[]; active: number; onPick: (p: Person) => void; anchor: RefObject<HTMLTextAreaElement | null> }) {
  // Above the chat box (it sits at the bottom of the panel), in its own layer so the panel never clips it.
  const [box, setBox] = useState<{ left: number; width: number; bottom: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (r) setBox({ left: r.left, width: Math.min(Math.max(r.width, 240), 360), bottom: window.innerHeight - r.top + 6 });
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [anchor]);
  useEffect(() => {
    document.getElementById(`${id}-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [id, active]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <ul
      id={id}
      role="listbox"
      aria-label="People you can mention"
      style={{ left: box?.left ?? 8, width: box?.width ?? 280, bottom: box?.bottom ?? 120 }}
      className="fixed z-[60] m-0 max-h-60 list-none overflow-auto rounded-xl border border-line bg-white p-1 shadow-xl"
    >
      {people.map((p, i) => (
        <li
          key={p.id}
          id={`${id}-${i}`}
          role="option"
          aria-selected={i === active}
          onMouseDown={(e) => {
            e.preventDefault(); // keeps focus in the chat box
            onPick(p);
          }}
          className={cx("flex min-h-11 cursor-pointer items-center rounded-lg px-3 text-sm", i === active ? "bg-ink text-gold" : "hover:bg-cream")}
        >
          {p.name}
        </li>
      ))}
    </ul>,
    document.body,
  );
}

/** A sent message with the people picked from the list shown as name chips. */
export function ChatMentionText({ text, people }: { text: string; people: readonly Person[] }): ReactNode {
  return splitChatMentions(text, people).map((s, i) =>
    s.type === "text" ? (
      <span key={i}>{s.text}</span>
    ) : (
      <span key={i} data-mention="" className="rounded bg-gold/90 px-1 font-semibold text-ink">
        @{s.name}
      </span>
    ),
  );
}
