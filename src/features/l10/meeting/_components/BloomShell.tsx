"use client";
// Copied from the Leadership Hub (src/app/meetings/_components/BloomShell.tsx); keep in step with it. See src/features/l10/README.md.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, cx, inputClass } from "@/features/l10/ui/ui";
import { MentionField } from "@/features/l10/ui/Mentions";
import { durationLabel, initials, mmddyyyy } from "@/features/l10/lib/bloom";
import type { PastMeeting } from "@/features/l10/lib/past";

/*
 * The parts every page of a Bloom-style meeting shares (the DM L10s; the owner's request, 15 Nov 2026): the Meeting
 * Notes drawer, the "Last meeting's summary" card and the "New Issue" bar pinned at the bottom. Hub colours and fonts;
 * Bloom's layout only.
 */

/** A panel on the right (a full-width sheet on a phone), with a close button and Esc; the floating buttons move clear of it. */
export function SidePanel({ title, closeLabel, onClose, footer, children, testId }: { title: string; closeLabel: string; onClose: () => void; footer?: ReactNode; children: ReactNode; testId?: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    // Esc closes the panel, unless something inside handled it first (an open @-mention list closes itself).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <aside role="dialog" aria-modal="false" aria-label={title} data-side-panel data-testid={testId} className="fixed inset-y-0 right-0 z-[45] flex w-full flex-col border-l border-line bg-cream shadow-2xl sm:w-[max(460px,50vw)] print:hidden">
      <div className="flex items-center gap-2 border-b border-line bg-white px-4 py-3">
        <h2 ref={heading} tabIndex={-1} className="m-0 min-w-0 flex-1 truncate text-base font-bold outline-none">
          {title}
        </h2>
        <button type="button" aria-label={closeLabel} onClick={onClose} className="inline-flex size-11 items-center justify-center rounded-xl text-lg text-muted hover:bg-cream hover:text-ink">
          ✕
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 py-4">{children}</div>
      {footer && <div className="flex flex-wrap items-center gap-2 border-t border-line bg-white px-4 py-3">{footer}</div>}
    </aside>
  );
}

/**
 * "Meeting Notes" under the agenda: the meeting's shared notes pad, as in Bloom. It edits `meetingNotes` in the meeting
 * document (the Hub keeps fields it does not know), so every saved version keeps it.
 */
export function MeetingNotes({ notes, onChange, saveStatus, disabled }: { notes: string; onChange: (v: string) => void; saveStatus?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => button.current?.focus());
  };
  return (
    <>
      <button ref={button} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)} className="mt-2 flex min-h-11 w-full items-center gap-2 border-t border-rule py-2 text-left text-sm font-semibold text-bronze-deep hover:underline">
        <span aria-hidden>✎</span> Meeting Notes
      </button>
      {open && (
        <SidePanel
          title="Meeting Notes"
          closeLabel="Close meeting notes"
          onClose={close}
          testId="meeting-notes-panel"
          footer={saveStatus ? <span className="ml-auto text-xs text-muted">{saveStatus}</span> : undefined}
        >
          <p className="m-0 text-sm text-muted">Shared with everyone in this meeting. Saves as you type.</p>
          <MentionField multiline aria-label="Meeting notes" value={notes} disabled={disabled} onChange={onChange} placeholder="Notes for this meeting… try @ and a name" className="min-h-[50vh] py-2" />
        </SidePanel>
      )}
    </>
  );
}

/** "Last meeting's summary": the most recent past meeting (a recap, or one imported from Bloom), collapsed by default. */
export function LastMeetingSummary({ last }: { last: PastMeeting | null }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="Last meeting's summary" className="rounded-[10px] border border-line bg-white shadow-card print:hidden">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-11 w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-bold">
        <span aria-hidden className={cx("text-xs text-muted transition-transform", open && "rotate-90")}>
          ▶
        </span>
        <span className="flex-1">Last meeting&apos;s summary</span>
        {last && <span className="font-mono text-xs font-normal text-muted">{mmddyyyy(last.heldAt)}</span>}
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-rule px-4 py-3 text-sm" data-testid="last-meeting-summary">
          {!last ? (
            <p className="m-0 text-muted">No past meeting yet. A summary shows here once a meeting is ended.</p>
          ) : (
            <>
              <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Held" value={mmddyyyy(last.heldAt)} />
                <Stat label="Meeting rating" value={last.ratingAvg === null ? "—" : String(last.ratingAvg)} />
                <Stat label="Issues solved" value={String(last.issuesSolved)} />
                <Stat label="Total time" value={durationLabel(last.durationSeconds)} />
              </dl>
              {last.attendees.length > 0 && (
                <ul aria-label="Ratings" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                  {last.attendees.map((a) => (
                    <li key={a.name} className="flex items-center gap-1.5 rounded-full bg-cream px-2 py-0.5 text-xs">
                      <span className="font-mono font-bold">{a.rating ?? "–"}</span>
                      {a.name}
                    </li>
                  ))}
                </ul>
              )}
              {last.solvedTitles.length > 0 && (
                <div>
                  <div className="text-xs font-bold tracking-[0.06em] text-muted">ISSUES SOLVED</div>
                  <ul className="m-0 mt-1 pl-5">
                    {last.solvedTitles.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}
              {last.cascade && (
                <div>
                  <div className="text-xs font-bold tracking-[0.06em] text-muted">CASCADING MESSAGE</div>
                  <p className="m-0 mt-1 whitespace-pre-wrap">{last.cascade}</p>
                </div>
              )}
              {last.notes && (
                <div>
                  <div className="text-xs font-bold tracking-[0.06em] text-muted">NOTES</div>
                  <p className="m-0 mt-1 whitespace-pre-wrap">{last.notes}</p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-cream/60 px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="m-0 font-mono text-base font-bold">{value}</dd>
    </div>
  );
}

/**
 * "New Issue", pinned at the bottom of every page as in Bloom: who owns it, the issue, Enter. It takes the place of the
 * floating Add to IDS button on these meetings and saves the same way (with an owner).
 */
export function NewIssueBar({ people, me, onAdd }: { people: string[]; me: string; onAdd: (title: string, owner: string) => void }) {
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState(people.includes(me) ? me : (people[0] ?? ""));
  const [notice, setNotice] = useState("");
  const submit = () => {
    const t = title.trim();
    if (!t) return;
    onAdd(t, owner);
    setNotice(`Added to IDS: ${t}`);
    setTitle("");
  };
  return (
    <form
      aria-label="New Issue"
      data-page-fab
      data-testid="new-issue-bar"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-line bg-white/95 px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))] shadow-[0_-8px_24px_-12px_rgb(10_10_10/0.18)] backdrop-blur print:hidden"
    >
      <span aria-hidden className="hidden size-8 flex-none items-center justify-center rounded-full bg-cream text-[11px] font-bold sm:flex" title={owner}>
        {initials(owner)}
      </span>
      <select aria-label="Issue owner" value={owner} onChange={(e) => setOwner(e.target.value)} className={cx(inputClass, "w-36 flex-none sm:w-44")}>
        {people.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>
      <input aria-label="New Issue" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New Issue… press Enter to add" className={cx(inputClass, "min-w-0 flex-1")} />
      <Button type="submit" variant="primary" disabled={!title.trim()}>
        Add
      </Button>
      <p role="status" aria-live="polite" className="sr-only">
        {notice}
      </p>
    </form>
  );
}
