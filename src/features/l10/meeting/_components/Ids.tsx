"use client";
// Copied from the Leadership Hub (src/app/meetings/_components/Ids.tsx); keep in step with it. See src/features/l10/README.md.

import { useState } from "react";
import confetti from "canvas-confetti";
import { Button, cx, inputClass } from "@/features/l10/ui/ui";
import { MentionField, MentionText, useMentionPlain, useMentionRoster } from "@/features/l10/ui/Mentions";
import { SharedFiles } from "./SharedFiles";
import { RANKS, canVote, groupRanks, issueTerm, myRank, newItemId, picksByVoter, recentlySolved, searchIssues, sortIssues, toggleSolved, toggleVote, usesPreviousOrder, type Rank, type Voter } from "@/features/l10/lib/doc";
import type { Attendee, Headline, Issue, IssueTerm, MeetingDoc, Rock, Todo } from "@/features/l10/lib/types";

/**
 * Ask Sunny: no ranking on IDS (the team's choice, 14 Nov 2026: issues are worked as in Bloom Growth, without the
 * "Everyone's top three" table, the Rank buttons or the Priority badges). The Hub keeps them; this switch is the only
 * difference, so re-copying the Hub's file means setting it to false again.
 */
const RANKING = false;

/** The three IDS lists, as in Bloom Growth: this week's issues, the ones parked for later, and the recently solved. */
export type IdsTab = IssueTerm | "solved";
const TAB_LABEL: Record<IdsTab, string> = { short: "Short term", long: "Long-term", solved: "Recently solved" };

/** Moving an issue between the lists releases its votes and old shared rank (only short-term issues are ranked). */
function withTerm(i: Issue, term: IssueTerm): Issue {
  const copy = { ...i, term } as Record<string, unknown>;
  delete copy.votes;
  delete copy.rank;
  return copy as Issue;
}

const initials = (name?: string) => (name ?? "").split(" ").map((n) => n[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

const firstName = (name: string) => name.trim().split(/[\s@]+/)[0]?.toLowerCase() ?? "";

export interface PriorityRow {
  name: string;
  /** This person's own #1, #2 and #3 open issue; empty when they have not ranked. */
  picks: Partial<Record<Rank, Issue>>;
  ranked: boolean;
}

/**
 * One row per attendee with their own top three, then anyone else who ranked (by the name stored with their votes).
 *
 * Matching rule: votes are keyed by the voter's sign-in id. An attendee is matched to a person on the meeting's
 * member list (l10_meeting_people, the @-mention roster) by full name, case-insensitive, and uses that person's votes.
 * Only when the attendee is not on the list, or two people on it share that full name, does it fall back to the first
 * name (the voter's stored sign-in first name); each voter is then used for one attendee at most.
 */
export function priorityRows(issues: Issue[], attendees: Pick<Attendee, "name">[], people: readonly { id: string; name: string }[] = []): PriorityRow[] {
  const voters = picksByVoter(issues);
  const voterById = new Map(voters.map((v) => [v.id, v]));
  const norm = (n: string) => n.trim().replace(/\s+/g, " ").toLowerCase();
  const rosterId = new Map<string, string | null>();
  for (const p of people) rosterId.set(norm(p.name), rosterId.has(norm(p.name)) ? null : p.id);
  const used = new Set<string>();
  const rows: PriorityRow[] = attendees
    .map((a) => a.name)
    .filter(Boolean)
    .map((name) => {
      const id = rosterId.get(norm(name));
      const match = id ? voterById.get(id) : voters.find((v) => !used.has(v.id) && firstName(v.name) === firstName(name));
      if (match) used.add(match.id);
      return { name, picks: match?.picks ?? {}, ranked: !!match };
    });
  for (const v of voters) if (!used.has(v.id)) rows.push({ name: v.name, picks: v.picks, ranked: true });
  return rows;
}

/** On a phone the column headers are hidden, so each pick is labelled in front (written out in full for Tailwind). */
const PHONE_RANK_LABEL: Record<Rank, string> = { 1: "max-[520px]:before:content-['#1']", 2: "max-[520px]:before:content-['#2']", 3: "max-[520px]:before:content-['#3']" };

/** Everyone's own 1, 2 and 3 side by side, so the room can see each person's priorities. */
export function PriorityTable({ issues, attendees }: { issues: Issue[]; attendees: Pick<Attendee, "name">[] }) {
  const roster = useMentionRoster();
  const rows = priorityRows(issues, attendees, roster);
  return (
    <section aria-label="Everyone's top three" className="flex flex-col gap-3 rounded-[10px] border border-line bg-white p-4 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-base font-bold">Everyone&rsquo;s top three</h3>
        <span className="text-xs text-muted">Press Rank to give an issue your 1, then 2, then 3. The room&rsquo;s top three move to the top of the list.</span>
      </div>
      {rows.length === 0 ? (
        <p className="m-0 text-sm text-muted" data-testid="priority-empty">
          Nobody has ranked yet.
        </p>
      ) : (
        // On a phone each person becomes a short stacked block (name, then #1, #2, #3) instead of four narrow columns.
        <table className="w-full table-fixed border-collapse text-sm max-[520px]:block">
          <thead className="max-[520px]:hidden">
            <tr className="border-b border-line text-left text-xs text-muted">
              <th scope="col" className="w-[22%] py-1.5 pr-2 font-semibold">Person</th>
              {RANKS.map((n) => (
                <th key={n} scope="col" className="py-1.5 pr-2 font-semibold">#{n}</th>
              ))}
            </tr>
          </thead>
          <tbody className="max-[520px]:block">
            {rows.map((r, n) => (
              <tr key={`${n}-${r.name}`} data-testid="priority-row" className="border-b border-rule align-top last:border-b-0 max-[520px]:block max-[520px]:py-2">
                <th scope="row" className="py-2 pr-2 text-left font-semibold break-words max-[520px]:block max-[520px]:py-0">
                  {r.name}
                  {!r.ranked && <span className="block text-xs font-normal text-muted">Not ranked yet</span>}
                </th>
                {RANKS.map((n) => {
                  const pick = r.picks[n];
                  return (
                    <td key={n} className={cx("py-2 pr-2 break-words max-[520px]:flex max-[520px]:gap-2 max-[520px]:py-0.5 max-[520px]:before:w-6 max-[520px]:before:flex-none max-[520px]:before:text-xs max-[520px]:before:font-bold max-[520px]:before:text-muted", PHONE_RANK_LABEL[n])}>
                      {pick ? <span><MentionText text={pick.title} /></span> : <span className="text-muted" aria-label="none">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {usesPreviousOrder(issues) && (
        <p className="m-0 text-xs text-muted" data-testid="rank-previous">
          Until someone ranks, the top of the list keeps the order from before per-person ranking.
        </p>
      )}
    </section>
  );
}

/** Identify, Discuss, Solve. Rank (each person their own 1–3), solve, edit, delete, and convert to a to-do, rock or headline. */
export function Ids({
  doc,
  edit,
  session,
  meetingKey,
  voter = { id: "anonymous", name: "Someone" },
  attendees = [],
}: {
  doc: MeetingDoc;
  edit: (fn: (d: MeetingDoc) => MeetingDoc) => void;
  session: string;
  meetingKey?: string;
  /** The signed-in person: their rank presses are recorded under this id and name. */
  voter?: Voter;
  /** The meeting's attendees, one row each in "Everyone's top three". */
  attendees?: Pick<Attendee, "name">[];
}) {
  const plain = useMentionPlain();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<IdsTab>("short");
  const [activeId, setActiveId] = useState<string | null>(null);
  /** The row whose Delete was pressed and awaits a second, deliberate press. */
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const setIssues = (fn: (xs: Issue[]) => Issue[]) => edit((d) => ({ ...d, issues: fn(d.issues) }));
  const filtered = searchIssues(sortIssues(doc.issues), query);
  const roomRanks = groupRanks(doc.issues);
  const shortTerm = filtered.filter((i) => !i.resolved && issueTerm(i) === "short");
  const longTerm = filtered.filter((i) => !i.resolved && issueTerm(i) === "long");
  const solved = recentlySolved(filtered);
  const lists: Record<IdsTab, Issue[]> = { short: shortTerm, long: longTerm, solved };
  const patch = (id: string, p: Partial<Issue>) => setIssues((xs) => xs.map((i) => (i.id === id ? { ...i, ...p } : i)));

  const add = () => {
    const t = text.trim();
    if (!t) return;
    // A new issue goes on the list being looked at (short-term when "Recently solved" is open).
    const term: IssueTerm = tab === "long" ? "long" : "short";
    setIssues((xs) => [...xs, { id: newItemId(), title: t, notes: "", resolved: false, ...(term === "long" ? { term } : {}) }]);
    setText("");
  };

  const remove = (id: string) => {
    setIssues((xs) => xs.filter((i) => i.id !== id));
    if (activeId === id) setActiveId(null);
    setConfirmId(null);
  };

  /** The selected issue's notes, files and actions, opened right under its row. */
  const detail = (active: Issue) => (
    <section id={`issue-detail-${active.id}`} aria-label="Issue detail" className="flex flex-col gap-3 rounded-b-[10px] border-t border-line bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <MentionField aria-label="Issue title" value={active.title} onChange={(v) => patch(active.id, { title: v })} wrapperClassName="min-w-[220px]" className="w-full text-lg font-bold" />
        <div className="flex gap-2">
          <Button variant={active.resolved ? "secondary" : "primary"} onClick={() => {
            if (!active.resolved) confetti();
            setIssues((xs) => toggleSolved(xs, active.id, session));
          }}>
            {active.resolved ? "Reopen" : "Solve"}
          </Button>
          <Button variant="outline" className="text-[#8a1c1c]" onClick={() => remove(active.id)}>
            Delete issue
          </Button>
        </div>
      </div>
      <MentionField multiline aria-label="Discussion notes" value={active.notes ?? ""} onChange={(v) => patch(active.id, { notes: v })} placeholder="Discussion notes: root cause, proposed solution, decisions…" className="min-h-[160px] py-2" />
      <SharedFiles
        meetingKey={meetingKey}
        issueId={active.id}
        files={active.files ?? []}
        onChange={(update) => setIssues((xs) => xs.map((i) => (i.id === active.id ? { ...i, files: update(i.files ?? []) } : i)))}
      />
      <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-3">
        <span className="text-xs text-muted">Convert to:</span>
        <Button variant="outline" onClick={() => edit((d) => ({ ...d, todos: [...d.todos, { id: newItemId(), text: active.title, owner: "—", due: "Next wk", done: false } as Todo] }))}>
          To-Do
        </Button>
        <Button variant="outline" onClick={() => edit((d) => ({ ...d, rocks: [...d.rocks, { id: newItemId(), title: active.title, owner: "Company", status: "on-track", milestones: [] } as Rock] }))}>
          Rock
        </Button>
        <Button variant="outline" onClick={() => edit((d) => ({ ...d, headlines: [...d.headlines, { id: newItemId(), kind: "customer", text: active.title, author: "IDS" } as Headline] }))}>
          Headline
        </Button>
        {!active.resolved && (
          <Button variant="outline" className="ml-auto" onClick={() => setIssues((xs) => xs.map((i) => (i.id === active.id ? withTerm(i, issueTerm(active) === "long" ? "short" : "long") : i)))}>
            {issueTerm(active) === "long" ? "Move to short term" : "Move to long-term"}
          </Button>
        )}
      </div>
    </section>
  );

  const row = (i: Issue) => {
    const isActive = i.id === activeId;
    const room = roomRanks.get(i.id);
    return (
      <li key={i.id} className={cx("rounded-[10px] border shadow-card", isActive ? "border-bronze bg-sunny" : "border-line bg-white")}>
        <div className="flex flex-wrap items-center gap-2 p-2.5">
          {(() => {
            const mine = myRank(i, voter.id);
            const can = canVote(doc.issues, i.id, voter.id);
            // Only short-term issues are ranked (and only when ranking is on).
            if (!RANKING || (!i.resolved && issueTerm(i) === "long")) return null;
            const hint = i.resolved
              ? "Solved issues are not ranked"
              : mine
                ? `Your #${mine}. Click again to clear it.`
                : !can
                  ? "You have used 1, 2 and 3: clear one of yours first"
                  : "Click to give this issue your next free number (1, 2, 3)";
            return (
              <button
                type="button"
                aria-label={`Rank by you: ${mine ?? "none"}: ${plain(i.title)}`}
                aria-pressed={!!mine}
                title={hint}
                aria-disabled={!can || undefined}
                onClick={() => can && setIssues((xs) => toggleVote(xs, i.id, voter))}
                className={cx(
                  "flex h-11 w-[5.25rem] flex-none items-center justify-center rounded-full border-2 px-2 text-sm font-bold whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black",
                  mine ? "border-bronze bg-sunny text-ink" : "border-line bg-cream text-muted hover:bg-white",
                  !can && !mine && "cursor-not-allowed opacity-50",
                )}
              >
                {mine ? `You: ${mine}` : "Rank"}
              </button>
            );
          })()}
          <button
            type="button"
            aria-expanded={isActive}
            aria-controls={isActive ? `issue-detail-${i.id}` : undefined}
            onClick={() => setActiveId(isActive ? null : i.id)}
            className={cx("min-w-[140px] flex-1 text-left text-sm", i.resolved && "text-muted line-through")}
          >
            {/* The room's top three (from everyone's ranks), worked in this order. */}
            {RANKING && room && (
              <>
                <span data-testid="room-rank" className="mr-1.5 inline-flex items-center rounded-full bg-gold px-2 py-0.5 align-middle text-[11px] font-extrabold whitespace-nowrap text-ink">
                  Priority {room}
                </span>{" "}
              </>
            )}
            <span className="font-semibold"><MentionText text={i.title} /></span>
            {(i.files?.length ?? 0) > 0 && <span className="ml-2 text-xs text-muted">📎 {i.files!.length}</span>}
          </button>
          {i.addedBy && (
            <span title={`Added by ${i.addedBy}`} className="flex size-6 flex-none items-center justify-center rounded-full bg-cream text-[10px] font-bold">
              {initials(i.addedBy)}
            </span>
          )}
          {confirmId === i.id ? (
            <span role="group" aria-label={`Confirm delete ${plain(i.title)}`} className="flex flex-none items-center gap-1.5" onKeyDown={(e) => e.key === "Escape" && setConfirmId(null)}>
              <span className="text-xs font-semibold text-red-700">Delete this issue?</span>
              <Button variant="outline" autoFocus className="text-red-700" aria-label={`Yes, delete ${plain(i.title)}`} onClick={() => remove(i.id)}>
                Yes, delete
              </Button>
              <Button variant="outline" aria-label={`Keep ${plain(i.title)}`} onClick={() => setConfirmId(null)}>
                Keep
              </Button>
            </span>
          ) : (
            <>
              <Button variant="outline" aria-label={`${i.resolved ? "Reopen" : "Solve"} ${plain(i.title)}`} onClick={() => {
                if (!i.resolved) confetti();
                setIssues((xs) => toggleSolved(xs, i.id, session));
              }}>
                {i.resolved ? "Reopen" : "Solve"}
              </Button>
              <Button variant="outline" className="text-red-700" aria-label={`Delete ${plain(i.title)}`} onClick={() => setConfirmId(i.id)}>
                Delete
              </Button>
            </>
          )}
        </div>
        {isActive && detail(i)}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {/* On a phone the field takes its own line and the button and search wrap below it; from sm up they share a row. */}
        <MentionField aria-label="Identify a new issue" value={text} onChange={setText} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Identify a new issue…" wrapperClassName="basis-full sm:basis-0 sm:min-w-[220px]" />
        <Button variant="primary" disabled={!text.trim()} onClick={add}>
          Add issue
        </Button>
        <input aria-label="Search issues" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search issues…" className={cx(inputClass, "w-48 max-sm:w-auto max-sm:flex-1")} />
      </div>
      <div role="tablist" aria-label="Issue lists" className="flex flex-wrap gap-1 border-b border-line">
        {(Object.keys(TAB_LABEL) as IdsTab[]).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            id={`ids-tab-${k}`}
            aria-selected={tab === k}
            aria-controls={`ids-panel-${k}`}
            onClick={() => setTab(k)}
            className={cx("-mb-px border-b-2 px-3 py-2 text-sm font-semibold", tab === k ? "border-bronze text-ink" : "border-transparent text-muted hover:text-ink")}
          >
            {TAB_LABEL[k]} ({lists[k].length})
          </button>
        ))}
      </div>
      {RANKING && tab === "short" && <PriorityTable issues={doc.issues.filter((i) => issueTerm(i) === "short")} attendees={attendees} />}
      <div role="tabpanel" id={`ids-panel-${tab}`} aria-labelledby={`ids-tab-${tab}`}>
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={tab === "short" ? "Open issues" : tab === "long" ? "Long-term issues" : "Solved issues"}>
          {lists[tab].map(row)}
          {lists[tab].length === 0 && (
            <li className="rounded-[10px] border border-dashed border-line p-4 text-sm text-muted">
              {query ? (tab === "solved" ? "No solved issues match." : "No open issues match.") : tab === "short" ? "No open issues. Nice work." : tab === "long" ? "No long-term issues." : "No solved issues yet."}
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
