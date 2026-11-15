"use client";
// Copied from the Leadership Hub (src/app/meetings/_components/Todos.tsx); keep in step with it. See src/features/l10/README.md.

import { useState } from "react";
import { Button, cx, inputClass } from "@/features/l10/ui/ui";
import { StatusBadge } from "@/features/l10/ui/StatusBadge";
import { MentionField, MentionText, useMentionPlain } from "@/features/l10/ui/Mentions";
import { newItemId, parseMention, sortTodos } from "@/features/l10/lib/doc";
import { todoState } from "@/features/l10/lib/dueStatus";
import type { Todo } from "@/features/l10/lib/types";
import { mmddyyyy } from "@/features/l10/lib/bloom";

const initials = (name: string) => name.split(" ").map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

export function Todos({ todos, onChange, people, today, bloom = false }: { todos: Todo[]; onChange: (next: Todo[]) => void; people: string[]; today: string; /** Laid out like Bloom Growth's To-dos (the DM L10s). */ bloom?: boolean }) {
  if (bloom) return <BloomTodos todos={todos} onChange={onChange} people={people} today={today} />;
  return <ListTodos todos={todos} onChange={onChange} people={people} today={today} />;
}

function ListTodos({ todos, onChange, people, today }: { todos: Todo[]; onChange: (next: Todo[]) => void; people: string[]; today: string }) {
  const plain = useMentionPlain();
  const [text, setText] = useState("");
  const [owner, setOwner] = useState("");
  const [due, setDue] = useState("");
  const mention = parseMention(text, people);
  const ownerFinal = mention.owner ?? owner;

  const add = () => {
    const t = mention.text.trim();
    if (!t) return;
    onChange([...todos, { id: newItemId(), text: t, owner: ownerFinal || "—", due: due || "Next wk", ...(due ? { dueDate: due } : {}), done: false }]);
    setText("");
    setDue("");
  };

  return (
    <div className="flex flex-col gap-3">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {sortTodos(todos, today).map((t) => {
          const state = todoState(t, today);
          return (
            <li key={t.id} className={cx("flex items-center gap-3 rounded-[10px] border p-3 shadow-card", state === "overdue" ? "border-[#8a1c1c]/50 bg-[#fbe4e4]/50" : state === "soon" ? "border-[#8a4a00]/40 bg-[#fdebd0]/40" : "border-line bg-white")}>
              <input type="checkbox" aria-label={`Done: ${plain(t.text)}`} checked={t.done} onChange={() => onChange(todos.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))} className="size-[18px] accent-bronze" />
              <span className="flex size-7 flex-none items-center justify-center rounded-full bg-cream text-[10px] font-bold">{initials(t.owner)}</span>
              <span className={cx("flex-1 text-sm", t.done && "text-muted line-through")}>
                <MentionText text={t.text} />
                {!t.done && (t.carryCount ?? 0) > 0 && <span className="ml-2 rounded-full border border-line px-1.5 py-0.5 text-[10px] text-muted">carried {t.carryCount}w</span>}
                {t.escalated && <span className="ml-2 rounded-full border border-[#8a1c1c]/40 px-1.5 py-0.5 text-[10px] font-bold text-[#8a1c1c]">moved to issues</span>}
              </span>
              <span className="hidden rounded-full bg-cream px-2.5 py-0.5 text-xs sm:inline">{t.owner}</span>
              {state !== "none" && <StatusBadge state={state} />}
              <span className={cx("text-xs", state === "overdue" ? "font-bold text-[#7a1717]" : "text-muted")}>{t.dueDate ?? t.due ?? ""}</span>
              <button type="button" aria-label={`Delete to-do ${plain(t.text)}`} className="text-xs text-muted hover:text-[#8a1c1c]" onClick={() => onChange(todos.filter((x) => x.id !== t.id))}>
                ✕
              </button>
            </li>
          );
        })}
        {todos.length === 0 && <li className="rounded-[10px] border border-dashed border-line p-4 text-sm text-muted">No to-dos yet.</li>}
      </ul>
      <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-dashed border-line bg-cream/60 p-3">
        <MentionField aria-label="New to-do" value={text} onChange={setText} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="New to-do… try @ and a name" className="min-w-[220px] flex-1" />
        <select aria-label="To-do owner" value={owner} onChange={(e) => setOwner(e.target.value)} className={cx(inputClass, "w-48")}>
          <option value="">Owner (optional)</option>
          {people.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <input aria-label="To-do due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} className={cx(inputClass, "w-40")} />
        <Button variant="primary" disabled={!mention.text.trim()} onClick={add}>
          Add to-do
        </Button>
        {mention.owner && <span className="text-xs text-muted">Assigned to {mention.owner}</span>}
      </div>
    </div>
  );
}

/**
 * To-dos as Bloom Growth lays them out (the DM L10s; the owner's request, 15 Nov 2026): "X% Completed", an
 * "Owner: A–Z" sort and a quick-add row (owner, the to-do, Enter) on top; each row has a round check, the owner's
 * initials (full name on hover), a chevron for the details, the text and the due date on the right as MM-DD-YYYY.
 */
function BloomTodos({ todos, onChange, people, today }: { todos: Todo[]; onChange: (next: Todo[]) => void; people: string[]; today: string }) {
  const plain = useMentionPlain();
  const [text, setText] = useState("");
  const [owner, setOwner] = useState(people[0] ?? "");
  const [ownerAz, setOwnerAz] = useState(false);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const mention = parseMention(text, people);
  const done = todos.filter((t) => t.done).length;
  const pct = todos.length ? Math.round((done / todos.length) * 100) : 0;
  const sorted = sortTodos(todos, today);
  const shown = ownerAz ? [...sorted].sort((a, b) => a.owner.localeCompare(b.owner)) : sorted;
  const add = () => {
    const t = mention.text.trim();
    if (!t) return;
    onChange([...todos, { id: newItemId(), text: t, owner: (mention.owner ?? owner) || "—", due: "Next wk", done: false }]);
    setText("");
  };
  const toggleOpen = (id: string) =>
    setOpenIds((ids) => {
      const next = new Set(ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div className="flex flex-col gap-3" data-testid="bloom-todos">
      <div className="flex flex-wrap items-center gap-2">
        <p className="m-0 flex-1 text-sm font-bold" data-testid="todos-completed">
          {pct}% Completed
        </p>
        <Button variant="outline" aria-pressed={ownerAz} onClick={() => setOwnerAz((v) => !v)} className="print:hidden">
          Owner: A–Z
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-dashed border-line bg-cream/60 p-2 print:hidden">
        <select aria-label="To-do owner" value={owner} onChange={(e) => setOwner(e.target.value)} className={cx(inputClass, "w-44")}>
          {people.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <MentionField aria-label="New to-do" value={text} onChange={setText} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="New To-do… press Enter to add" wrapperClassName="min-w-[220px] flex-1" />
        <Button variant="primary" disabled={!mention.text.trim()} onClick={add}>
          Add
        </Button>
      </div>
      <ul aria-label="To-dos" className="m-0 flex list-none flex-col overflow-hidden rounded-[10px] border border-line bg-white p-0 shadow-card">
        {shown.map((t) => {
          const state = todoState(t, today);
          const open = openIds.has(t.id);
          const dueText = t.dueDate ? mmddyyyy(t.dueDate) : (t.due ?? "");
          return (
            <li key={t.id} className="border-t border-rule first:border-t-0">
              <div className="flex items-center gap-3 px-3 py-2">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={t.done}
                  aria-label={`Done: ${plain(t.text)}`}
                  onClick={() => onChange(todos.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))}
                  className={cx("flex size-5 flex-none items-center justify-center rounded-full border-2 text-[11px] font-bold", t.done ? "border-[#2f8a43] bg-[#2f8a43] text-white" : "border-line bg-white hover:border-bronze")}
                >
                  {t.done ? "✓" : ""}
                </button>
                <span title={t.owner} className="flex size-7 flex-none items-center justify-center rounded-full bg-cream text-[10px] font-bold">
                  <span aria-hidden>{initials(t.owner)}</span>
                  <span className="sr-only">{t.owner}</span>
                </span>
                <button type="button" aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} details: ${plain(t.text)}`} onClick={() => toggleOpen(t.id)} className="inline-flex size-7 flex-none items-center justify-center rounded text-muted hover:bg-cream hover:text-ink">
                  <span aria-hidden className={cx("text-[10px] transition-transform", open && "rotate-90")}>
                    ▶
                  </span>
                </button>
                <span className={cx("min-w-0 flex-1 text-sm", t.done && "text-muted line-through")}>
                  <MentionText text={t.text} />
                </span>
                {state !== "none" && <StatusBadge state={state} />}
                <span data-testid="todo-due" className={cx("flex-none font-mono text-xs", state === "overdue" && !t.done ? "font-bold text-[#7a1717]" : "text-muted")}>
                  {dueText}
                </span>
              </div>
              {open && (
                <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5 pl-[4.75rem] text-xs text-muted">
                  <span>Owner: {t.owner}</span>
                  {!t.done && (t.carryCount ?? 0) > 0 && <span className="rounded-full border border-line px-1.5 py-0.5">carried {t.carryCount}w</span>}
                  {t.escalated && <span className="rounded-full border border-[#8a1c1c]/40 px-1.5 py-0.5 font-bold text-[#8a1c1c]">moved to issues</span>}
                  <button type="button" aria-label={`Delete to-do ${plain(t.text)}`} className="ml-auto text-muted hover:text-[#8a1c1c]" onClick={() => onChange(todos.filter((x) => x.id !== t.id))}>
                    Delete
                  </button>
                </div>
              )}
            </li>
          );
        })}
        {todos.length === 0 && <li className="p-4 text-sm text-muted">No to-dos yet.</li>}
      </ul>
    </div>
  );
}
