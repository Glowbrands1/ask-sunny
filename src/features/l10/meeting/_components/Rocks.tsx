"use client";
// Copied from the Leadership Hub (src/app/meetings/_components/Rocks.tsx); keep in step with it. See src/features/l10/README.md.

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, cx, inputClass } from "@/features/l10/ui/ui";
import { MentionField, useMentionPlain } from "@/features/l10/ui/Mentions";
import { StatusBadge } from "@/features/l10/ui/StatusBadge";
import { milestoneState, rockState } from "@/features/l10/lib/dueStatus";
import { duplicateRock, newItemId, ROCK_STATUS_LABEL, ROCK_STATUS_ORDER, rockSections } from "@/features/l10/lib/doc";
import type { Milestone, Rock, RockStatus } from "@/features/l10/lib/types";

const ownerInitials = (name: string) => name.split(" ").map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

const STATUS_TONE: Record<RockStatus, string> = { "on-track": "bg-ok text-ink", "off-track": "bg-warn text-warn-ink", done: "border border-[#1b5e2a] bg-[#e1f1e4] text-[#154a21] print:border-black print:bg-white print:text-black" };

function RockRow({ rock, today, open, onOpen, onChange }: { rock: Rock; today: string; open: boolean; onOpen: () => void; onChange: (r: Rock) => void }) {
  const done = rock.milestones.filter((m) => m.done).length;
  const patch = (p: Partial<Rock>) => onChange({ ...rock, ...p });
  const rState = rockState(rock, today);
  return (
    <div className={cx("border-t border-rule first:border-t-0", rock.archived && "opacity-60", open && "bg-sunny")}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          data-rock-open={rock.id}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Edit ${rock.title}`}
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-start gap-2 text-left"
        >
          <span aria-hidden className={cx("mt-0.5 text-xs text-muted", open && "text-bronze-deep")}>
            ›
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
    </div>
  );
}

/**
 * Editing one rock: a panel on the right (a full-width sheet on a phone), like a goal drawer, while the list stays on
 * the left (the owner's request, 15 Nov 2026). The same fields and the same save path as the inline editor it replaces;
 * the close button and Esc close it. The floating buttons move clear of it (globals.css, [data-side-panel]).
 */
function RockPanel({ rock, owners, today, saveStatus, onChange, onDuplicate, onDelete, onClose }: { rock: Rock; owners: string[]; today: string; saveStatus?: string; onChange: (r: Rock) => void; onDuplicate: (owner: string) => void; onDelete: () => void; onClose: () => void }) {
  const [newMs, setNewMs] = useState("");
  const plain = useMentionPlain();
  const patch = (p: Partial<Rock>) => onChange({ ...rock, ...p });
  const setMs = (id: string, p: Partial<Milestone>) => patch({ milestones: rock.milestones.map((m) => (m.id === id ? { ...m, ...p } : m)) });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [rock.id]);
  useEffect(() => {
    // Esc closes the panel, unless something inside handled it first (an open @-mention list closes itself).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="rock-panel-title"
      data-side-panel
      data-testid="rock-panel"
      className="fixed inset-y-0 right-0 z-[45] flex w-full flex-col border-l border-line bg-cream shadow-2xl sm:w-[max(460px,50vw)] print:hidden"
    >
      <div className="flex items-center gap-2 border-b border-line bg-white px-4 py-3">
        <h2 id="rock-panel-title" ref={heading} tabIndex={-1} className="m-0 min-w-0 flex-1 truncate text-base font-bold outline-none">
          Edit rock
        </h2>
        <button type="button" aria-label="Close rock editor" onClick={onClose} className="inline-flex size-11 items-center justify-center rounded-xl text-lg text-muted hover:bg-cream hover:text-ink">
          ✕
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            Due date
            <input type="date" aria-label={`Due date of ${rock.title}`} value={rock.dueDate ?? ""} onChange={(e) => patch({ dueDate: e.target.value || undefined })} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            Status
            <select aria-label={`Status of ${rock.title}`} value={rock.status} onChange={(e) => patch({ status: e.target.value as RockStatus })} className={cx(inputClass, "rounded-full font-bold", STATUS_TONE[rock.status])}>
              {ROCK_STATUS_ORDER.map((st) => (
                <option key={st} value={st}>
                  {ROCK_STATUS_LABEL[st]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs font-bold text-muted">
          Rock title
          <input value={rock.title} onChange={(e) => patch({ title: e.target.value })} className={cx(inputClass, "text-base font-semibold")} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-muted">
          Details
          <MentionField multiline aria-label={`Notes for ${rock.title}`} value={rock.notes ?? ""} onChange={(v) => patch({ notes: v })} placeholder="Context, blockers, updates… try @ and a name" className="min-h-40 py-2" />
        </label>
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            Attach to owner
            <span className="flex items-center gap-2">
              <span aria-hidden className="flex size-8 flex-none items-center justify-center rounded-full bg-white text-[11px] font-bold text-ink ring-1 ring-line">
                {ownerInitials(rock.owner)}
              </span>
              <select aria-label={`Owner of ${rock.title}`} value={rock.owner} onChange={(e) => patch({ owner: e.target.value })} className={cx(inputClass, "flex-1")}>
                {owners.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </span>
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
        <select aria-label={`Duplicate ${rock.title} to`} value="" onChange={(e) => e.target.value && onDuplicate(e.target.value)} className={cx(inputClass, "w-56")}>
          <option value="">Duplicate to…</option>
          {owners.filter((o) => o !== rock.owner).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </div>
      {/* Autosaves as you type, as everywhere on the page: no Save button. The meeting's save status, repeated quietly. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-line bg-white px-4 py-3">
        <Button variant="outline" onClick={() => patch({ archived: !rock.archived })}>
          {rock.archived ? "Restore rock" : "Archive rock"}
        </Button>
        <Button variant="outline" className="text-[#8a1c1c]" onClick={() => (onDelete(), onClose())}>
          Delete rock
        </Button>
        {saveStatus && (
          <span data-testid="rock-panel-save-status" className="ml-auto text-xs text-muted">
            {saveStatus}
          </span>
        )}
      </div>
    </aside>
  );
}

export function Rocks({ rocks, onChange, people, today, saveStatus }: { rocks: Rock[]; onChange: (next: Rock[]) => void; people: string[]; today: string; /** The meeting's save status in words, shown quietly in the rock panel's footer. */ saveStatus?: string }) {
  const [showArchived, setShowArchived] = useState(false);
  // One rock open at a time, in the panel on the right.
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = openId ? rocks.find((r) => r.id === openId) : undefined;
  const close = useCallback(() => {
    const id = openId;
    setOpenId(null);
    // Back to the row that opened it, so keyboard users keep their place.
    if (id) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-rock-open="${CSS.escape(id)}"]`)?.focus());
  }, [openId]);
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
      {/* The add form comes first, under the section title, so anyone can add a rock without scrolling (owner's request, 13 Nov 2026). */}
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
      {rockSections(rocks, people, showArchived).map(([who, list]) => (
        <section key={who} aria-label={who === "Company" ? "Company Rocks" : `${who}'s Rocks`} className="overflow-hidden rounded-[10px] border border-line bg-white shadow-card">
          <div className="flex items-baseline gap-2 border-b border-line bg-cream px-3 py-2">
            <h3 className="m-0 text-base font-bold">{who === "Company" ? "Company Rocks" : `${who}'s Rocks`}</h3>
            <span className="text-xs text-muted">
              {list.length} rock{list.length === 1 ? "" : "s"}
            </span>
          </div>
          {list.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted">{who === "Company" ? "No company rocks yet. Add one above with owner “Company”." : `No rocks for ${who} yet. Add one above, or duplicate a company rock here.`}</div>
          ) : (
            list.map((r) => (
              <RockRow key={r.id} rock={r} today={today} open={r.id === openId} onOpen={() => setOpenId(r.id)} onChange={(next) => onChange(rocks.map((x) => (x.id === r.id ? next : x)))} />
            ))
          )}
        </section>
      ))}
      {archivedCount > 0 && (
        <Button variant="link" className="self-start" onClick={() => setShowArchived((s) => !s)}>
          {showArchived ? "Hide" : "Show"} archived ({archivedCount})
        </Button>
      )}
      {opened && (
        <RockPanel
          rock={opened}
          owners={owners}
          today={today}
          saveStatus={saveStatus}
          onChange={(next) => onChange(rocks.map((x) => (x.id === opened.id ? next : x)))}
          onDuplicate={(o) => onChange([...rocks, duplicateRock(opened, o, newItemId)])}
          onDelete={() => onChange(rocks.filter((x) => x.id !== opened.id))}
          onClose={close}
        />
      )}
    </div>
  );
}
