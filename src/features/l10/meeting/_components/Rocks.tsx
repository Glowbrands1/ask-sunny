"use client";
// Copied from the Leadership Hub (src/app/meetings/_components/Rocks.tsx); keep in step with it. See src/features/l10/README.md.

import { useState } from "react";
import { Button, cx, inputClass } from "@/features/l10/ui/ui";
import { MentionField, useMentionPlain } from "@/features/l10/ui/Mentions";
import { StatusBadge } from "@/features/l10/ui/StatusBadge";
import { milestoneState, rockState } from "@/features/l10/lib/dueStatus";
import { duplicateRock, newItemId, ROCK_STATUS_LABEL, ROCK_STATUS_ORDER, rockSections } from "@/features/l10/lib/doc";
import type { Milestone, Rock, RockStatus } from "@/features/l10/lib/types";

const STATUS_TONE: Record<RockStatus, string> = { "on-track": "bg-ok text-ink", "off-track": "bg-warn text-warn-ink", done: "border border-[#1b5e2a] bg-[#e1f1e4] text-[#154a21] print:border-black print:bg-white print:text-black" };

function RockCard({ rock, owners, today, onChange, onDuplicate, onDelete }: { rock: Rock; owners: string[]; today: string; onChange: (r: Rock) => void; onDuplicate: (owner: string) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [newMs, setNewMs] = useState("");
  const plain = useMentionPlain();
  const done = rock.milestones.filter((m) => m.done).length;
  const patch = (p: Partial<Rock>) => onChange({ ...rock, ...p });
  const setMs = (id: string, p: Partial<Milestone>) => patch({ milestones: rock.milestones.map((m) => (m.id === id ? { ...m, ...p } : m)) });
  const rState = rockState(rock, today);
  return (
    <div className={cx("border-t border-rule first:border-t-0", rock.archived && "opacity-60")}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button type="button" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${rock.title}`} onClick={() => setOpen((o) => !o)} className="flex min-w-0 flex-1 items-start gap-2 text-left">
          <span aria-hidden className={cx("mt-0.5 text-xs text-muted transition-transform", open && "rotate-90")}>
            ▶
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{rock.title}</span>
            <span className="block text-xs text-muted">
              {rock.milestones.length > 0 && `${done}/${rock.milestones.length} milestones`}
              {rock.dueDate && <span className={cx(rState === "overdue" && "font-bold text-[#7a1717]")}>{rock.milestones.length > 0 ? " · " : ""}due {rock.dueDate}</span>}
              {rock.archived && " · archived"}
            </span>
          </span>
        </button>
        {(rState === "overdue" || rState === "soon") && <StatusBadge state={rState} />}
        <button
          type="button"
          title={`Change status from ${ROCK_STATUS_LABEL[rock.status]}`}
          aria-label={`${rock.title}: ${ROCK_STATUS_LABEL[rock.status]}. Change status`}
          onClick={() => patch({ status: ROCK_STATUS_ORDER[(ROCK_STATUS_ORDER.indexOf(rock.status) + 1) % ROCK_STATUS_ORDER.length] })}
          className={cx("rounded-md px-2.5 py-1 text-xs font-bold whitespace-nowrap hover:ring-2 hover:ring-gold/60", STATUS_TONE[rock.status])}
        >
          {ROCK_STATUS_LABEL[rock.status]}
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-3 bg-cream/50 px-4 py-3">
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            Rock title
            <input value={rock.title} onChange={(e) => patch({ title: e.target.value })} className={inputClass} />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs font-bold text-muted">
              Owner
              <select aria-label={`Owner of ${rock.title}`} value={rock.owner} onChange={(e) => patch({ owner: e.target.value })} className={inputClass}>
                {owners.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-muted">
              Due date
              <input type="date" aria-label={`Due date of ${rock.title}`} value={rock.dueDate ?? ""} onChange={(e) => patch({ dueDate: e.target.value || undefined })} className={inputClass} />
            </label>
            {rock.owner === "Company" && (
              <label className="flex flex-col gap-1 text-xs font-bold text-muted">
                Who leads this company rock
                <select aria-label={`Lead of ${rock.title}`} value={rock.lead ?? ""} onChange={(e) => patch({ lead: e.target.value || undefined })} className={inputClass}>
                  <option value="">—</option>
                  {owners.filter((o) => o !== "Company").map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div>
            <div className="mb-1 text-xs font-bold text-muted">Milestones</div>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {rock.milestones.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2">
                  <input type="checkbox" aria-label={`Milestone done: ${plain(m.text)}`} checked={m.done} onChange={() => setMs(m.id, { done: !m.done })} className="size-[18px] accent-bronze" />
                  <MentionField aria-label="Milestone text" value={m.text} onChange={(v) => setMs(m.id, { text: v })} wrapperClassName="min-w-[200px] flex-1" className={cx(m.done && "text-muted line-through")} />
                  <input type="date" aria-label={`Milestone due date: ${plain(m.text)}`} value={m.dueDate ?? ""} onChange={(e) => setMs(m.id, { dueDate: e.target.value || undefined })} className={cx(inputClass, "w-40", milestoneState(m, today) === "overdue" && "border-[#8a1c1c]")} />
                  {milestoneState(m, today) !== "none" && <StatusBadge state={milestoneState(m, today) as "done" | "overdue" | "soon"} />}
                  <button type="button" aria-label={`Delete milestone ${plain(m.text)}`} className="text-xs text-muted hover:text-[#8a1c1c]" onClick={() => patch({ milestones: rock.milestones.filter((x) => x.id !== m.id) })}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <MentionField aria-label="Add milestone" value={newMs} onChange={setNewMs} placeholder="Add milestone… try @ and a name" onKeyDown={(e) => e.key === "Enter" && newMs.trim() && (patch({ milestones: [...rock.milestones, { id: newItemId(), text: newMs.trim(), done: false }] }), setNewMs(""))} wrapperClassName="flex-1" />
              <Button variant="outline" disabled={!newMs.trim()} onClick={() => (patch({ milestones: [...rock.milestones, { id: newItemId(), text: newMs.trim(), done: false }] }), setNewMs(""))}>
                Add milestone
              </Button>
            </div>
          </div>
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            Notes
            <MentionField multiline aria-label={`Notes for ${rock.title}`} value={rock.notes ?? ""} onChange={(v) => patch({ notes: v })} placeholder="Context, blockers, updates… try @ and a name" className="min-h-20 py-2" />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label={`Duplicate ${rock.title} to`} value="" onChange={(e) => e.target.value && onDuplicate(e.target.value)} className={cx(inputClass, "w-56")}>
              <option value="">Duplicate to…</option>
              {owners.filter((o) => o !== rock.owner).map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
            <Button variant="outline" onClick={() => patch({ archived: !rock.archived })}>
              {rock.archived ? "Restore rock" : "Archive rock"}
            </Button>
            <Button variant="outline" className="text-[#8a1c1c]" onClick={onDelete}>
              Delete rock
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Rocks({ rocks, onChange, people, today }: { rocks: Rock[]; onChange: (next: Rock[]) => void; people: string[]; today: string }) {
  const [showArchived, setShowArchived] = useState(false);
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState("Company");
  const [due, setDue] = useState("");
  const owners = ["Company", ...people];
  const archivedCount = rocks.filter((r) => r.archived).length;
  const add = () => {
    if (!title.trim()) return;
    onChange([...rocks, { id: newItemId(), title: title.trim(), owner, status: "on-track", milestones: [], ...(due ? { dueDate: due } : {}) }]);
    setTitle("");
    setDue("");
  };
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      {rockSections(rocks, people, showArchived).map(([who, list]) => (
        <section key={who} aria-label={who === "Company" ? "Company Rocks" : `${who}'s Rocks`} className="overflow-hidden rounded-[10px] border border-line bg-white shadow-card">
          <div className="flex items-baseline gap-2 border-b border-line bg-cream px-3 py-2">
            <h3 className="m-0 text-base font-bold">{who === "Company" ? "Company Rocks" : `${who}'s Rocks`}</h3>
            <span className="text-xs text-muted">
              {list.length} rock{list.length === 1 ? "" : "s"}
            </span>
          </div>
          {list.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted">{who === "Company" ? "No company rocks yet. Add one below with owner “Company”." : `No rocks for ${who} yet. Add one below, or duplicate a company rock here.`}</div>
          ) : (
            list.map((r) => (
              <RockCard
                key={r.id}
                rock={r}
                owners={owners}
                today={today}
                onChange={(next) => onChange(rocks.map((x) => (x.id === r.id ? next : x)))}
                onDuplicate={(o) => onChange([...rocks, duplicateRock(r, o, newItemId)])}
                onDelete={() => onChange(rocks.filter((x) => x.id !== r.id))}
              />
            ))
          )}
        </section>
      ))}
      {archivedCount > 0 && (
        <Button variant="link" className="self-start" onClick={() => setShowArchived((s) => !s)}>
          {showArchived ? "Hide" : "Show"} archived ({archivedCount})
        </Button>
      )}
      <div className="rounded-[10px] border border-dashed border-line bg-cream/60 p-3 print:hidden">
        <div className="mb-2 text-xs font-bold text-muted">Add new rock</div>
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label="New rock title" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Rock title…" className={cx(inputClass, "min-w-[220px] flex-1")} />
          <select aria-label="New rock owner" value={owner} onChange={(e) => setOwner(e.target.value)} className={cx(inputClass, "w-48")}>
            {owners.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
          <input type="date" aria-label="New rock due date" value={due} onChange={(e) => setDue(e.target.value)} className={cx(inputClass, "w-40")} />
          <Button variant="primary" disabled={!title.trim()} onClick={add}>
            Add rock
          </Button>
        </div>
      </div>
    </div>
  );
}
