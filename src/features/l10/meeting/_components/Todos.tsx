"use client";
// Copied from the Leadership Hub (src/app/meetings/_components/Todos.tsx); keep in step with it. See src/features/l10/README.md.

import { useState } from "react";
import { Button, cx, inputClass } from "@/features/l10/ui/ui";
import { StatusBadge } from "@/features/l10/ui/StatusBadge";
import { MentionField, MentionText, useMentionPlain } from "@/features/l10/ui/Mentions";
import { newItemId, parseMention, sortTodos } from "@/features/l10/lib/doc";
import { todoState } from "@/features/l10/lib/dueStatus";
import type { Todo } from "@/features/l10/lib/types";

const initials = (name: string) => name.split(" ").map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

export function Todos({ todos, onChange, people, today }: { todos: Todo[]; onChange: (next: Todo[]) => void; people: string[]; today: string }) {
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
