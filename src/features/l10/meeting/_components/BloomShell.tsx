"use client";
// Copied from the Leadership Hub (src/app/meetings/_components/BloomShell.tsx); keep in step with it. See src/features/l10/README.md.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Modal, cx, inputClass } from "@/features/l10/ui/ui";
import { MentionField } from "@/features/l10/ui/Mentions";
import { durationLabel, initials, mmddyyyy } from "@/features/l10/lib/bloom";
import type { PastMeeting } from "@/features/l10/lib/past";

/*
 * The parts every page of a Bloom-style meeting shares (the DM L10s; the owner's request, 15 Nov 2026): the Meeting
 * Notes drawer, the "Last meeting's summary" card and the floating "New Issue" button. Hub colours and fonts;
 * Bloom's layout only.
 */

/**
 * A panel on the right (a full-width sheet on a phone), with a close button and Esc; the floating buttons move clear of it.
 *
 * It is rendered through a portal, not where it is used: a `position: fixed` element is pinned to the nearest ancestor with
 * a backdrop-filter or transform, and the agenda card (glass) has one, so Meeting Notes opened inside it showed on the
 * left, half off-screen (the owner's report, 15 Nov 2026). It goes to the page's `.hub-l10` root when there is one (the
 * DM L10 tab in Ask Sunny / Ask Bubbles, which keeps that root's scoped styles), otherwise to `document.body`.
 */
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
  return createPortal(
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
    </aside>,
    document.querySelector(".hub-l10") ?? document.body,
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
          <MentionField multiline aria-label="Meeting notes" value={notes} disabled={disabled} onChange={onChange} placeholder="Notes for this meeting… try @ and a name" className="min-h-64 py-2" />
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
 * "New Issue": a floating button on every agenda page that opens a small window (the issue, who owns it, Add), saved
 * the same way as before (with an owner and who added it).
 *
 * Port from Ask Bubbles: it was an inline bar at the top of each page, so the To-do and IDS pages showed two places
 * to add (the owner, 17 Nov 2026: "in ask sunny DM L10 there 2 of these, just need 1"). It sits where the Add to IDS
 * button sits on the other meetings (`ParkIt`), and "i" opens it.
 */
export function NewIssueButton({ people, me, onAdd, open, setOpen }: { people: string[]; me: string; onAdd: (title: string, owner: string) => void; open: boolean; setOpen: (open: boolean) => void }) {
  const [title, setTitle] = useState("");
  const [owner, setOwner] = useState(people.includes(me) ? me : (people[0] ?? ""));
  const [notice, setNotice] = useState("");
  const submit = () => {
    const t = title.trim();
    if (!t) return;
    onAdd(t, owner);
    setNotice(`Added to IDS: ${t}`);
    setTitle("");
    setOpen(false);
  };
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)} data-page-fab data-testid="new-issue-button" className="fixed right-(--fab-right) bottom-(--fab-bottom) z-40 min-h-(--fab-h) rounded-full shadow-card print:hidden" title="Add an issue to IDS">
        + New Issue
      </Button>
      <p role="status" aria-live="polite" className="sr-only">
        {notice}
      </p>
      <Modal
        open={open}
        title="New Issue"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={!title.trim()} onClick={submit}>
              Add to IDS
            </Button>
          </>
        }
      >
        <form
          aria-label="New Issue"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex flex-col gap-3"
        >
          <input aria-label="New Issue" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The issue… press Enter to add" className={inputClass} />
          <label className="flex flex-col gap-1 text-xs font-bold text-muted">
            Owner
            <span className="flex items-center gap-2">
              <span aria-hidden className="flex size-8 flex-none items-center justify-center rounded-full bg-cream text-[11px] font-bold text-ink" title={owner}>
                {initials(owner)}
              </span>
              <select aria-label="Issue owner" value={owner} onChange={(e) => setOwner(e.target.value)} className={cx(inputClass, "flex-1")}>
                {people.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </span>
          </label>
        </form>
      </Modal>
    </>
  );
}
