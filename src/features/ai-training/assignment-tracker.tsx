"use client";

import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, useTransition } from "react";
import { Check, ChevronLeft, ChevronRight, ClipboardCheck, UserPlus, X } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/controls";
import { EmptyState } from "@/components/ui/feedback";
import { Input, Label, Textarea } from "@/components/ui/field";
import { ScrollTable } from "@/components/ui/layout";
import {
  HALF_STATUS_LABEL,
  TRACKER_START_MONTH,
  currentHalfSummary,
  formatDay,
  halfOf,
  markKey,
  monthIndex,
  monthInfo,
  nextMarkState,
  personTotals,
  sortPeople,
  statusOf,
  type AssignmentMark,
  type AssignmentPerson,
  type AssignmentTracker,
  type Half,
  type HalfStatus,
  type MarkState,
} from "@/lib/ai-training/assignments";
import { cn } from "@/lib/utils/cn";

import type { ActionResult } from "./actions";
import { addAssignmentPeopleAction, removeAssignmentPersonAction, setAssignmentMarkAction } from "./assignment-actions";

/**
 * AI TRAINING -> ASSIGNMENTS (Pau, 23 Nov 2026): the twice-monthly AI assignment tracker, in the app's own look.
 * Shown only to the tracker's named people (the page decides; the Server Functions check again).
 */

const VISIBLE_MONTHS = 6;

const TONE: Record<HalfStatus, BadgeTone> = {
  done: "ready",
  extended: "primary",
  due: "attention",
  missing: "failed",
  upcoming: "outline",
  not_started: "outline",
};

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  function run(work: () => Promise<ActionResult>, done = "Saved", onFail?: () => void) {
    setMessage(null);
    start(async () => {
      const result = await work();
      if (!result.ok) {
        setMessage({ tone: "error", text: result.message });
        onFail?.();
      } else {
        setMessage({ tone: "ok", text: done });
        router.refresh();
      }
    });
  }
  return { pending, message, run };
}

function Message({ message }: { message: { tone: "ok" | "error"; text: string } | null }) {
  return (
    <p role="status" className={cn("min-h-5 text-[13px]", message?.tone === "error" ? "text-status-failed" : "text-muted-foreground")}>
      {message?.text ?? ""}
    </p>
  );
}

export function AssignmentTrackerPanel({ tracker, today }: { tracker: AssignmentTracker; today: string }) {
  /* Marks change on the screen at once; the server's rows replace them on refresh, and a failed save puts them back. */
  const [marks, setMarks] = useState<readonly AssignmentMark[]>(tracker.marks);
  const [fromServer, setFromServer] = useState(tracker.marks);
  if (fromServer !== tracker.marks) {
    setFromServer(tracker.marks);
    setMarks(tracker.marks);
  }
  const view = useMemo(() => ({ people: tracker.people, marks }), [tracker.people, marks]);
  const { message, run } = useAction();

  function mark(person: AssignmentPerson, month: string, half: Half, state: MarkState | null) {
    const before = marks;
    setMarks([...marks.filter((m) => !(m.personId === person.id && m.month === month && m.half === half)), ...(state ? [{ personId: person.id, month, half, state }] : [])]);
    run(() => setAssignmentMarkAction({ personId: person.id, month, half, state }), "Saved", () => setMarks(before));
  }

  return (
    <div className="space-y-6">
      <Summary tracker={view} today={today} onDone={(p, month, half) => mark(p, month, half, "done")} />
      <Grid tracker={view} today={today} message={message} onMark={mark} />
      <People people={tracker.people} marks={marks} />
    </div>
  );
}

/* ---------------- this half ---------------- */

function Summary({
  tracker,
  today,
  onDone,
}: {
  tracker: AssignmentTracker;
  today: string;
  onDone: (person: AssignmentPerson, month: string, half: Half) => void;
}) {
  const now = currentHalfSummary(tracker, today);
  const counted = now.done.length + now.due.length + now.extended.length;
  const pct = counted ? Math.round((now.done.length / counted) * 100) : 0;

  if (!tracker.people.length) {
    return (
      <EmptyState
        icon={<ClipboardCheck />}
        title="No one is on the tracker yet"
        description="Add names under People below. Each person has two AI assignments a month: the 1st to 15th, and the 16th to month end."
      />
    );
  }

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start gap-x-10 gap-y-5">
        <div className="min-w-[180px]">
          <p className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">This half · {now.label}</p>
          <p className="mt-2 text-3xl font-semibold text-foreground tabular-nums">
            {now.done.length}
            <span className="ml-1.5 text-sm font-normal text-muted-foreground">of {counted} done</span>
          </p>
          <Progress value={pct} label={`${pct}% done`} className="mt-3 w-44 max-w-full" />
        </div>
        <div className="min-w-[220px] flex-1 space-y-4">
          <div>
            <p className="mb-2 text-[13px] font-medium text-foreground">
              Still to do{now.due.length ? ` (${now.due.length})` : ""}
              <span className="font-normal text-muted-foreground"> · select a name to mark it done</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {now.due.length ? (
                now.due.map((p) => (
                  <Button key={p.id} type="button" size="sm" variant="secondary" onClick={() => onDone(p, now.month, now.half)} aria-label={`Mark ${p.name} done for ${now.label}`}>
                    {p.name}
                  </Button>
                ))
              ) : (
                <Badge tone="ready" size="md">Everyone is done or has more time</Badge>
              )}
            </div>
          </div>
          {now.extended.length ? (
            <div>
              <p className="mb-2 text-[13px] font-medium text-foreground">Asked for more time ({now.extended.length})</p>
              <div className="flex flex-wrap gap-2">
                {now.extended.map((p) => (
                  <Button key={p.id} type="button" size="sm" variant="soft" onClick={() => onDone(p, now.month, now.half)} aria-label={`Mark ${p.name} done for ${now.label}`}>
                    {p.name}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

/* ---------------- the grid ---------------- */

function Grid({
  tracker,
  today,
  message,
  onMark,
}: {
  tracker: AssignmentTracker;
  today: string;
  message: { tone: "ok" | "error"; text: string } | null;
  onMark: (person: AssignmentPerson, month: string, half: Half, state: MarkState | null) => void;
}) {
  const first = monthIndex(TRACKER_START_MONTH);
  const current = monthIndex(halfOf(today).month);
  const thisMonthStart = Math.max(first, current - 1);
  const [offset, setOffset] = useState(thisMonthStart);
  const months = Array.from({ length: VISIBLE_MONTHS }, (_, i) => monthInfo(offset + i));
  const marks = useMemo(() => new Map(tracker.marks.map((m) => [markKey(m.personId, m.month, m.half), m.state])), [tracker.marks]);
  const people = sortPeople(tracker.people);
  const columns = 3 + VISIBLE_MONTHS * 2;

  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Monthly grid</h2>
          <p className="text-[13px] text-muted-foreground">Select a box to change it: Due, Done, More time, then back.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={offset <= first} onClick={() => setOffset((o) => Math.max(first, o - 1))}>
            <ChevronLeft aria-hidden /> Earlier
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={offset === thisMonthStart} onClick={() => setOffset(thisMonthStart)}>
            This month
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setOffset((o) => o + 1)}>
            Later <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
      <Message message={message} />

      <ScrollTable className="mt-2">
        <table className="w-full text-center text-[12.5px] tabular-nums">
          <thead className="bg-surface-muted text-[11px] tracking-wide text-muted-foreground uppercase">
            <tr>
              <th scope="col" rowSpan={2} className="sticky left-0 z-10 min-w-[160px] bg-surface-muted px-3 py-2 text-left font-semibold">Name</th>
              <th scope="col" rowSpan={2} className="px-3 py-2 font-semibold">Done</th>
              <th scope="col" rowSpan={2} className="px-3 py-2 font-semibold">Missing</th>
              {months.map((m) => (
                <th key={m.key} scope="colgroup" colSpan={2} className={cn("border-l border-border px-3 pt-2 font-semibold whitespace-nowrap text-foreground", m.index === current && "bg-accent-soft")}>
                  {m.label}
                </th>
              ))}
            </tr>
            <tr>
              {months.map((m) => (
                <Fragment key={m.key}>
                  <th scope="col" className={cn("border-l border-border px-3 pb-2 font-normal whitespace-nowrap normal-case", m.index === current && "bg-accent-soft")}>1–15</th>
                  <th scope="col" className={cn("px-3 pb-2 font-normal whitespace-nowrap normal-case", m.index === current && "bg-accent-soft")}>16–{m.lastDay}</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.length === 0 ? (
              <tr>
                <td colSpan={columns} className="px-3 py-8 text-muted-foreground">No one to track yet.</td>
              </tr>
            ) : null}
            {people.map((person, i) => {
              const totals = personTotals(person, marks, today);
              const heading = person.group && person.group !== (people[i - 1]?.group ?? null);
              return (
                <Fragment key={person.id}>
                  {heading ? (
                    <tr>
                      <td colSpan={columns} className="border-t border-border bg-surface-muted px-3 py-1.5 text-left text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                        {person.group}
                      </td>
                    </tr>
                  ) : null}
                  <tr className="border-t border-border">
                    <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-2 text-left text-[13px] font-medium text-foreground">{person.name}</th>
                    <td className="px-3 py-2 font-semibold text-foreground">{totals.done}</td>
                    <td className={cn("px-3 py-2", totals.missing ? "font-semibold text-status-failed" : "text-muted-foreground")}>{totals.missing}</td>
                    {months.map((m) =>
                      ([0, 1] as const).map((half) => {
                        const status = statusOf(person, m.key, half, marks, today);
                        const range = half === 0 ? "1st to 15th" : "16th to month end";
                        return (
                          <td key={`${m.key}-${half}`} className={cn("px-1.5 py-1.5", half === 0 && "border-l border-border", m.index === current && "bg-accent-soft/40")}>
                            {status === "not_started" ? (
                              <span className="text-muted-foreground" title="Before their start date">–</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onMark(person, m.key, half, nextMarkState(marks.get(markKey(person.id, m.key, half))))}
                                aria-label={`${person.name}, ${m.label}, ${range}: ${HALF_STATUS_LABEL[status]}`}
                                className="block w-full rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
                              >
                                <Badge tone={TONE[status]} className={cn("w-full min-w-[76px] justify-center hover:brightness-95", status === "upcoming" && "border-dashed")}>
                                  {status === "done" ? <Check aria-hidden className="size-3" /> : null}
                                  {status === "upcoming" ? "–" : HALF_STATUS_LABEL[status]}
                                </Badge>
                              </button>
                            )}
                          </td>
                        );
                      }),
                    )}
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </ScrollTable>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-muted-foreground">
        <span className="flex items-center gap-1.5"><Badge tone="ready"><Check aria-hidden className="size-3" />Done</Badge> marked complete</span>
        <span className="flex items-center gap-1.5"><Badge tone="attention">Due</Badge> this half, not done yet</span>
        <span className="flex items-center gap-1.5"><Badge tone="primary">More time</Badge> asked for an extension</span>
        <span className="flex items-center gap-1.5"><Badge tone="failed">Missing</Badge> half ended, not done</span>
      </div>
    </Card>
  );
}

/* ---------------- people ---------------- */

function People({ people, marks }: { people: readonly AssignmentPerson[]; marks: readonly AssignmentMark[] }) {
  const [names, setNames] = useState("");
  const [group, setGroup] = useState("");
  const [startDate, setStartDate] = useState("");
  const [armed, setArmed] = useState<string | null>(null);
  const add = useAction();
  const remove = useAction();
  const groups = [...new Set(people.map((p) => p.group).filter((g): g is string => !!g))].sort();
  const sorted = sortPeople(people);

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-foreground">People</h2>
      <form
        className="mt-4 grid max-w-xl gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          add.run(() => addAssignmentPeopleAction({ names, group, startDate }), "Added to the roster");
          if (names.trim()) {
            setNames("");
            setStartDate("");
          }
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="assign-names">Add people, one name per line</Label>
          <Textarea id="assign-names" rows={3} value={names} onChange={(e) => setNames(e.target.value)} placeholder={"First Last\nFirst Last"} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="assign-group">Group (optional)</Label>
            <Input id="assign-group" list="assign-groups" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="e.g. a team or department" />
            <datalist id="assign-groups">
              {groups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="assign-start">Start date, if they joined recently (optional)</Label>
            <Input id="assign-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={add.pending || !names.trim()}>
            <UserPlus aria-hidden /> Add to roster
          </Button>
          <Message message={add.message} />
        </div>
      </form>

      <Message message={remove.message} />
      {sorted.length ? (
        <ul className="divide-y divide-border">
          {sorted.map((p) => {
            const done = marks.filter((m) => m.personId === p.id && m.state === "done").length;
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium break-words text-foreground">{p.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {[p.group, p.startDate ? `Started ${formatDay(p.startDate)}` : null, `${done} marked done`].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {armed === p.id ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={remove.pending}
                      onClick={() => {
                        setArmed(null);
                        remove.run(() => removeAssignmentPersonAction({ personId: p.id }), `Removed ${p.name}`);
                      }}
                    >
                      Remove and clear {done} {done === 1 ? "mark" : "marks"}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setArmed(null)}>
                      Keep
                    </Button>
                  </span>
                ) : (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setArmed(p.id)} aria-label={`Remove ${p.name}`}>
                    <X aria-hidden /> Remove
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="py-4 text-sm text-muted-foreground">Nobody yet.</p>
      )}
    </Card>
  );
}
