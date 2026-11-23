"use client";
// Copied from the Leadership Hub (src/app/meetings/MeetingView.tsx); keep in step with it. See src/features/l10/README.md.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, ButtonLink, Card, Modal, cx } from "@/features/l10/ui/ui";
import { agendaFromRoster, salonsFor, bloomStyle, cadenceLabel, hintsFromRoster, referenceFromRoster, segueName, type AgendaKey, type MeetingKey, type Roster } from "@/features/l10/lib/config";
import { buildRecap, effectiveAttendees, keepHiddenAttendees, markRecapped, newItemId, ratingAttendees } from "@/features/l10/lib/doc";
import { elapsedSeconds, emptyTimer, endedTimer, formatClock, pausedTimer, plannedSeconds, isReferenceView, readTimer, resumedTimer, startMeeting, type View } from "@/features/l10/lib/timer";
import type { LoadedMeeting, MeetingInfo, RecapRow } from "@/features/l10/lib/types";
import { pastMeetings } from "@/features/l10/lib/past";
import { AUTO_SAVED_LABEL, wasAutoSaved } from "@/features/l10/lib/autosave";
import { AccountabilityChart } from "./_components/AccountabilityChart";
import { BusinessBest } from "./_components/BusinessBest";
import { Conclude, type EndFn } from "./_components/Conclude";
import { Headlines } from "./_components/Headlines";
import { Ids } from "./_components/Ids";
import { PrintButton } from "./_components/PrintButton";
import { ParkIt } from "./_components/ParkIt";
import { LastMeetingSummary, MeetingNotes, NewIssueButton } from "./_components/BloomShell";
import { LastMeetingConclusion, LastWeekFeedback, SegueQuestion } from "./_components/BloomSections";
import { BusinessPlan } from "./_components/BusinessPlan";
import { Rocks } from "./_components/Rocks";
import { Scorecard } from "./_components/Scorecard";
import { Todos } from "./_components/Todos";
import { statusText, useMeetingSync, type LoadFn, type SaveFn } from "./useMeetingSync";
import { useStoredFlag } from "./useStoredFlag";
import { useLeaveGuard } from "./useLeaveGuard";
import { ownerMenu } from "@/features/l10/lib/ownerMenu";
import { MentionRoster } from "@/features/l10/ui/Mentions";
import type { Person } from "@/features/l10/lib/mentions";

/** A running meeting this far past its planned agenda time offers to end it. */
const OVERTIME_SECONDS = 10 * 60;

const SHORTCUTS = "N or → next · P or ← back · Space start or pause · T new to-do · I add to IDS · ? this help";

export function MeetingView({
  info,
  initial,
  save,
  end,
  load,
  viewer,
  serverTime,
  today,
  dateLabel,
  roster,
  hubMeetingUrl,
  mentionPeople = [],
  readOnly,
  initialView,
  debounceMs,
  pollMs,
  recaps = [],
  ownerPeople = [],
}: {
  /** Ask Sunny: DM-or-higher people from Woven, added after the meeting's own people in the to-do and issue owner menus. */
  ownerPeople?: string[];
  /** Open on a reference view (from a link such as ?view=accountability). */
  initialView?: "accountability" | "business-plan";
  info: MeetingInfo;
  initial: LoadedMeeting;
  /** Not needed (and never called) for a read-only old version. */
  save?: SaveFn;
  end?: EndFn;
  load?: LoadFn;
  viewer: { id: string; label: string; name?: string };
  /** Today, e.g. "Sun, Nov 1", for the header. */
  dateLabel?: string;
  /** Who sits in this meeting, served by the Hub (Ask Sunny's repository carries no names). */
  roster: Roster;
  /** This meeting in the Leadership Hub (absolute), for "Open in Leadership Hub". */
  hubMeetingUrl: string;
  /** The people who can open this meeting, for the @-picker. Empty: no picker. */
  mentionPeople?: Person[];
  /** An old saved version, shown for reading only: nothing is saved, no clock, no shortcuts, inputs disabled, banner on top. */
  readOnly?: { version: number; savedAtLabel: string; historyHref: string };
  /** The server's time when the page was rendered, to correct for a wrong laptop clock. */
  serverTime?: number;
  today: string;
  debounceMs?: number;
  pollMs?: number;
  /** This meeting's recaps, newest first, for "Last meeting's summary" (Bloom-style meetings only). */
  recaps?: RecapRow[];
}) {
  const key = info.key as MeetingKey;
  // The Hub's agenda and hints, served with the roster (Ask Sunny: so a change in the Hub's config reaches this page).
  const agenda = agendaFromRoster(key, roster);
  const hints = hintsFromRoster(key, roster);
  // The Reference views exist only where the meeting has them (not the STC DM L10; the Hub says so with the roster).
  const reference = referenceFromRoster(key, roster);
  // The DM L10's pages are laid out like Bloom Growth's (the owner's request, 15 Nov 2026).
  const bloom = bloomStyle(key);
  // The most recent past meeting (a recap, or one imported from Bloom), for the summaries on those pages.
  const last = bloom ? (pastMeetings(recaps, initial.doc)[0] ?? null) : null;
  const [view, setViewLocal] = useState<View>((reference && initialView) || agenda[0].key);
  // An old version can never save or end a meeting: whatever happens, these refuse.
  const refuse = { ok: false as const, kind: "forbidden" as const, message: "This is an old version and cannot be changed." };
  const saveFn: SaveFn = readOnly || !save ? async () => refuse : save;
  const endFn: EndFn = readOnly || !end ? async () => refuse : end;
  const { doc, edit, status, retry, flushNow, serverNow } = useMeetingSync({ meetingKey: info.key, initial, save: saveFn, load, serverTime, debounceMs, pollMs });

  const [sectionElapsed, setSectionElapsed] = useState<Partial<Record<AgendaKey, number>>>({});
  const [extras, setExtras] = useState<Partial<Record<AgendaKey, number>>>({});
  const people = roster.members.map((m) => m.name);
  // Ask Sunny: the owner menus for to-dos, issues and rocks also list every DM-or-higher person from Woven (owners.server.ts).
  const owners = ownerMenu(people, ownerPeople);
  // The agenda panel can be tucked away; the choice is remembered in this browser for this person.
  const [agendaHidden, setAgendaHidden] = useStoredFlag(`l10-agenda-hidden:${viewer.id}`);
  // Port from Ask Bubbles: on the Bloom-style Scorecard, "Full width" hides the agenda column so the table uses the
  // whole page (the owner, 18 Nov 2026: "make this … wide have the option to do that"). Remembered in this browser.
  const [scorecardWide, setScorecardWide] = useStoredFlag(`l10-scorecard-wide:${viewer.id}`);
  const attendees = effectiveAttendees(roster, doc.attendees);

  /* ── The shared clock ─────────────────────────────────────────────── */
  // An old version never shows a live meeting: no clock, no leader, no "meeting over" card.
  const timer = readOnly ? emptyTimer() : readTimer(doc);
  const isLeader = !!timer.leader && timer.leader === viewer.id;
  /** The signed-in person's full name (from the meeting's people), saved on each issue they add. */
  const myName = (mentionPeople.find((p) => p.id === viewer.id)?.name ?? viewer.name ?? "").trim();
  // Only a person the Hub lists for this meeting (by their sign-in id), with their full name, gets a rating row of their own.
  const meListed = (mentionPeople.find((p) => p.id === viewer.id)?.name ?? "").trim();
  /** Who rates the meeting at Conclude: the attendees, plus the signed-in person if they are not listed (see ratingAttendees). */
  const raters = ratingAttendees(attendees, doc.attendees ?? [], meListed);
  const live = timer.started && !timer.ended;
  // The first render uses the server's render time (the same number on the server and in the browser), so the clock
  // text the server sent matches what the browser renders first (no hydration mismatch); it catches up right after.
  const [now, setNow] = useState(() => serverTime ?? serverNow());
  useEffect(() => {
    if (!timer.running) return;
    const first = setTimeout(() => setNow(serverNow()), 0);
    const id = setInterval(() => setNow(serverNow()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [timer.running, timer.startedAt, serverNow]);
  const elapsed = elapsedSeconds(timer, now);

  const setTimer = (fn: (t: ReturnType<typeof readTimer>) => ReturnType<typeof readTimer>) => edit((d) => ({ ...d, timer: fn(readTimer(d)) }));

  // When the leader changes section, every screen follows (the leader's view is part of the shared document).
  const selectView = (v: View) => {
    if (isReferenceView(v) && !reference) return;
    setViewLocal(v);
    if (live && isLeader) setTimer((t) => ({ ...t, leaderView: v }));
  };
  // Other screens follow the leader whenever the leader's section changes (adjusted while rendering, not in an effect).
  const [followed, setFollowed] = useState<View | null>(null);
  if (!isLeader && live && timer.leaderView && followed !== timer.leaderView) {
    setFollowed(timer.leaderView);
    if ((reference && isReferenceView(timer.leaderView)) || agenda.some((a) => a.key === timer.leaderView)) setViewLocal(timer.leaderView);
  }

  const index = agenda.findIndex((a) => a.key === view);
  const section = agenda.find((a) => a.key === view);
  const go = (i: number) => selectView(agenda[Math.max(0, Math.min(agenda.length - 1, i))].key);

  const start = () => {
    edit((d) => startMeeting(d, serverNow(), viewer, attendees));
    setNow(serverNow());
    setViewLocal(agenda[0].key);
    elapsedBySection.current = {};
    setSectionElapsed({});
    setExtras({});
  };

  // Time in each section is this screen's own count, as in Lovable. It only shows the clock: the meeting never moves
  // itself to the next section when a section's planned time runs out (Madeline Patterson, 23 Nov 2026: "it moves us
  // to the next section after a certain timeframe, even when we aren't ready yet"). The leader moves on with Next.
  // The count itself lives in a ref (state is only for showing it).
  const elapsedBySection = useRef<Partial<Record<AgendaKey, number>>>({});
  useEffect(() => {
    if (!timer.running || isReferenceView(view)) return;
    const id = setInterval(() => {
      elapsedBySection.current = { ...elapsedBySection.current, [view]: (elapsedBySection.current[view] ?? 0) + 1 };
      setSectionElapsed(elapsedBySection.current);
    }, 1000);
    return () => clearInterval(id);
  }, [timer.running, view]);

  /* ── Keyboard shortcuts ───────────────────────────────────────────── */
  const [parkOpen, setParkOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const toggleClock = () => {
    if (!timer.started || timer.ended) start();
    else if (isLeader) setTimer((t) => (t.running ? pausedTimer(t, serverNow()) : resumedTimer(t, serverNow())));
  };
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyHandler.current = (e: KeyboardEvent) => {
      if (readOnly) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === "n" || e.key === "N" || e.key === "ArrowRight") {
        e.preventDefault();
        go(index + 1);
      } else if (e.key === "p" || e.key === "P" || e.key === "ArrowLeft") {
        e.preventDefault();
        go(index - 1);
      } else if (e.key === " ") {
        e.preventDefault();
        toggleClock();
      } else if (e.key === "t" || e.key === "T") {
        const t = agenda.findIndex((a) => a.key === "todos");
        if (t < 0) return;
        e.preventDefault();
        go(t);
        setTimeout(() => document.querySelector<HTMLInputElement>('input[aria-label="New to-do"]')?.focus(), 60);
      } else if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        // A Bloom-style meeting has the New Issue window instead of the Add to IDS one; the same key opens either.
        setParkOpen(true);
      } else if (e.key === "?") {
        e.preventDefault();
        setHelp((h) => !h);
      }
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const leaderName = isLeader ? "You're leading" : timer.leaderLabel ? `${timer.leaderLabel} is leading` : "";
  const planned = plannedSeconds(section?.minutes ?? 0, isReferenceView(view) ? 0 : (extras[view] ?? 0));
  const inSection = isReferenceView(view) ? 0 : (sectionElapsed[view] ?? 0);
  // Share of the planned agenda time used so far: each section's time on this screen, never counted past its plan.
  const totalPlanned = agenda.reduce((sum, a) => sum + plannedSeconds(a.minutes, extras[a.key] ?? 0), 0);
  const donePlanned = agenda.reduce((sum, a) => sum + Math.min(sectionElapsed[a.key] ?? 0, plannedSeconds(a.minutes, extras[a.key] ?? 0)), 0);
  const progressPct = totalPlanned ? Math.min(100, Math.round((donePlanned / totalPlanned) * 100)) : 0;

  /* ── Leaving a running meeting ────────────────────────────────────── */
  // A recap exists only if someone ends the meeting, so leaving a live meeting asks first, and a meeting that runs
  // well past its planned time says so. (If nobody ends it, the database saves it later, marked as auto-saved.)
  const guard = useLeaveGuard(live && !readOnly);
  const [endBusy, setEndBusy] = useState(false);
  const [endError, setEndError] = useState("");
  const pastPlannedTime = live && totalPlanned > 0 && elapsed > totalPlanned + OVERTIME_SECONDS;
  /** The same steps as Conclude's "End meeting & save recap". Returns true when the recap is saved. */
  const endAndSave = async (): Promise<boolean> => {
    if (endBusy) return false;
    setEndBusy(true);
    setEndError("");
    try {
      if (!(await flushNow())) {
        setEndError("Your latest changes are not saved yet, so the recap was not saved. Try again in a moment.");
        return false;
      }
      const sessionKey = timer.sessionId ?? "pending";
      const id = timer.sessionId ?? new Date(serverNow()).toISOString();
      const res = await endFn(info.key, buildRecap(doc, raters, sessionKey, id, elapsed));
      if (!res.ok) {
        setEndError(res.message);
        return false;
      }
      edit((d) => ({ ...d, issues: markRecapped(d.issues, sessionKey, id), timer: endedTimer(readTimer(d), serverNow()) }));
      await flushNow();
      return true;
    } catch {
      setEndError("The recap was not saved. Nothing was lost: try again.");
      return false;
    } finally {
      setEndBusy(false);
    }
  };

  return (
    <MentionRoster value={mentionPeople}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {/* Ask Sunny opens this one meeting; the full Hub (every meeting, the tracker) is one click away. */}
          <a href={hubMeetingUrl} target="_blank" rel="noopener noreferrer" data-testid="open-in-hub" className="text-[13px] font-semibold text-bronze-deep hover:underline print:hidden">
            Open in Leadership Hub ↗
          </a>
          <h1 className="m-0 mt-0.5 text-[26px] font-bold">{info.name}</h1>
          <p className="m-0 text-sm text-muted">
            {dateLabel ? `${dateLabel} · ` : ""}
            {info.team} · {cadenceLabel(key, info.cadence, agenda)}
            {!live && roster.leader ? ` · Usually led by ${roster.leader}` : ""}
          </p>
        </div>
        {readOnly ? (
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <PrintButton />
            <Link href={readOnly.historyHref} className="inline-flex min-h-11 items-center px-2 text-[13px] font-semibold text-bronze-deep hover:underline">
              Back to version history
            </Link>
          </div>
        ) : (
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {/* Export PDF is per meeting: it opens this meeting's report (only its data), which prints from there. */}
          <ButtonLink href={`/meetings/${info.key}/report`} variant="outline" title="Opens this meeting's report, ready to print or save as PDF">
            Export PDF
          </ButtonLink>
          <Link href={`/meetings/${info.key}/past`} className="inline-flex min-h-11 items-center px-2 text-[13px] font-semibold text-bronze-deep hover:underline">
            Past meetings
          </Link>
          <Link href={`/meetings/${info.key}/history`} className="inline-flex min-h-11 items-center px-2 text-[13px] font-semibold text-bronze-deep hover:underline">
            History
          </Link>
          {live ? (
            <div className="flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 shadow-card">
              <span className="text-[11px] font-bold tracking-wider text-muted uppercase">Elapsed</span>
              <span data-testid="clock" className="font-mono text-xl font-bold tabular-nums">
                {formatClock(elapsed)}
              </span>
              {isLeader && (
                <>
                  <Button variant="outline" aria-label={timer.running ? "Pause the meeting clock" : "Resume the meeting clock"} onClick={toggleClock}>
                    {timer.running ? "Pause" : "Resume"}
                  </Button>
                  <Button variant="outline" aria-label="Reset the meeting clock" onClick={() => setTimer(() => emptyTimer())}>
                    Reset
                  </Button>
                </>
              )}
            </div>
          ) : (
            <Button variant="primary" onClick={start}>
              Start meeting
            </Button>
          )}
          {live && leaderName && <span className="rounded-full bg-cream px-3 py-1.5 text-xs font-semibold">{leaderName}</span>}
          {viewer.name && viewer.id !== "anonymous" && (
            <span data-testid="signed-in-as" className="flex items-center gap-2 text-xs text-muted">
              Signed in as <b className="text-ink">{viewer.name}</b>
            </span>
          )}
          <p role="status" aria-live="polite" data-testid="save-status" data-status={status.kind} className={cx("m-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold", status.kind === "failed" ? "bg-warn text-warn-ink" : "bg-cream text-muted")}>
            {statusText(status)}
            {status.kind === "failed" && (
              <Button variant="link" className="ml-2" onClick={retry}>
                Try again
              </Button>
            )}
          </p>
        </div>
        )}
      </header>

      {readOnly && (
        <div role="note" data-testid="history-banner" className="rounded-[10px] border-2 border-ink bg-sunny px-4 py-3 text-sm font-semibold">
          You are looking at version {readOnly.version} from {readOnly.savedAtLabel}; nothing here is live. Nothing you see can be changed or saved.
        </div>
      )}

      <p className="m-0 hidden text-sm print:block">{`${info.name} · ${view === "business-plan" ? "Business Plan" : view === "accountability" ? "Accountability Chart" : (section?.title ?? "")} · printed ${today}`}</p>

      {help && (
        <p role="note" className="m-0 rounded-lg bg-cream px-4 py-2 text-sm">
          {SHORTCUTS}
        </p>
      )}

      {pastPlannedTime && !guard.pending && (
        <div role="status" data-testid="past-planned-time" className="flex flex-wrap items-center gap-3 rounded-[10px] border border-warn bg-warn/30 px-4 py-3 text-sm print:hidden">
          <span className="min-w-0 flex-1">
            <b>This meeting is past its planned time.</b> End it to save the recap for the whole team.
          </span>
          <Button variant="primary" disabled={endBusy} onClick={() => void endAndSave()}>
            {endBusy ? "Saving the recap…" : "End meeting & save recap"}
          </Button>
          {endError && (
            <p role="alert" className="m-0 basis-full text-sm font-semibold text-[#8a1c1c]">
              {endError}
            </p>
          )}
        </div>
      )}

      <Modal
        open={guard.pending !== null}
        title="End the meeting before you leave?"
        onClose={() => {
          setEndError("");
          guard.cancel();
        }}
        footer={
          <>
            <Button
              onClick={() => {
                setEndError("");
                guard.cancel();
              }}
            >
              Stay
            </Button>
            <Button onClick={guard.proceed}>Leave without ending</Button>
            <Button
              variant="primary"
              disabled={endBusy}
              onClick={async () => {
                if (await endAndSave()) guard.proceed();
              }}
            >
              {endBusy ? "Saving the recap…" : "End meeting & save recap"}
            </Button>
          </>
        }
      >
        <p className="m-0 text-sm">
          This meeting is still running. Ending it saves the recap (ratings, to-dos, solved issues and the cascading message) for the whole team.
        </p>
        <p className="m-0 text-sm text-muted">
          If nobody ends it, it is saved automatically later and marked &ldquo;Auto-saved: meeting was not ended&rdquo;.
        </p>
        {endError && (
          <p role="alert" className="m-0 text-sm font-semibold text-[#8a1c1c]">
            {endError}
          </p>
        )}
      </Modal>

      {timer.ended ? (
        <Card aria-label="Meeting over" className="flex flex-col gap-3">
          <h2 className="m-0 text-xl font-bold">{wasAutoSaved(doc) ? AUTO_SAVED_LABEL : "This meeting was ended and its recap saved"}</h2>
          {wasAutoSaved(doc) && (
            <p data-testid="meeting-auto-saved" className="m-0 text-sm">
              Nobody pressed End, so the recap was saved automatically from the last saved state.
            </p>
          )}
          <p className="m-0 text-sm text-muted">{`Start a new meeting to begin with clean ratings and ${segueName(key)}, or reopen this one to keep going.`}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={start}>
              Start a new meeting
            </Button>
            <Button onClick={() => setTimer(() => emptyTimer())}>Reopen this meeting</Button>
            <Link href={`/meetings/${info.key}/recaps`} className="inline-flex min-h-11 items-center px-2 text-[13px] font-semibold text-bronze-deep hover:underline">
              See recaps
            </Link>
          </div>
        </Card>
      ) : (
        <div className="flex flex-wrap items-start gap-4">
          {!(bloom && view === "scorecard" && scorecardWide) && (
          <Card aria-label="Agenda" className={cx("flex flex-col gap-1 print:hidden", agendaHidden ? "flex-[0_0_auto]" : "flex-[0_1_280px] max-[700px]:flex-auto")}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="m-0 text-base font-bold">{agendaHidden ? "Agenda" : `Agenda · ${agenda.reduce((s, a) => s + a.minutes, 0)} min`}</h2>
              <Button variant="outline" aria-expanded={!agendaHidden} aria-label={agendaHidden ? "Show the agenda" : "Hide the agenda"} onClick={() => setAgendaHidden(!agendaHidden)}>
                {agendaHidden ? "Show" : "Hide"}
              </Button>
            </div>
            <div className="mb-2 flex flex-col gap-1" aria-label="Agenda progress">
              <div className="flex items-center justify-between text-xs text-muted">
                <span>Agenda progress</span>
                <span data-testid="agenda-progress" className="font-mono">{progressPct}%</span>
              </div>
              <span role="progressbar" aria-label="Agenda progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPct} className="h-1.5 w-full overflow-hidden rounded-full bg-cream">
                <span className="block h-full bg-gold" style={{ width: `${progressPct}%` }} />
              </span>
            </div>
            {!agendaHidden && (
              <>
            <ol className="m-0 list-none p-0">
              {agenda.map((a, i) => (
                <li key={a.key}>
                  <button
                    type="button"
                    aria-current={a.key === view ? "step" : undefined}
                    onClick={() => selectView(a.key)}
                    className={cx("flex min-h-11 w-full items-center justify-between gap-2 border-t border-rule py-2 text-left text-sm hover:text-bronze-deep", a.key === view && "font-bold text-bronze-deep")}
                  >
                    <span>
                      {i + 1} · {a.title}
                    </span>
                    <span className="font-mono text-xs text-muted">{a.minutes + (extras[a.key] ?? 0)}m</span>
                  </button>
                </li>
              ))}
            </ol>
            {bloom && <MeetingNotes notes={typeof doc.meetingNotes === "string" ? doc.meetingNotes : ""} onChange={(v) => edit((d) => ({ ...d, meetingNotes: v }))} saveStatus={readOnly ? undefined : statusText(status)} disabled={!!readOnly} />}
            {reference && (
              <>
                <div className="mt-3 text-xs font-bold tracking-[0.06em] text-muted">REFERENCE</div>
                <button type="button" aria-current={view === "business-plan" ? "step" : undefined} onClick={() => selectView("business-plan")} className={cx("flex min-h-11 w-full items-center border-t border-rule py-2 text-left text-sm hover:text-bronze-deep", view === "business-plan" && "font-bold text-bronze-deep")}>
                  Business Plan
                </button>
                <button type="button" aria-current={view === "accountability" ? "step" : undefined} onClick={() => selectView("accountability")} className={cx("flex min-h-11 w-full items-center border-t border-rule py-2 text-left text-sm hover:text-bronze-deep", view === "accountability" && "font-bold text-bronze-deep")}>
                  Accountability Chart
                </button>
              </>
            )}
              </>
            )}
          </Card>
          )}

          <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
            {bloom && <LastMeetingSummary last={last} />}
            {bloom && view === "business-best" && <LastWeekFeedback last={last} />}
            {!isReferenceView(view) && index >= 0 && (
              <div role="group" aria-label="Section controls" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-line bg-white px-4 py-2.5 text-sm shadow-card print:hidden">
                <span className="font-semibold" data-testid="section-position">
                  Section {index + 1} of {agenda.length}
                </span>
                <span data-testid="section-clock" className={cx("font-mono text-xs text-muted", inSection > planned && "font-bold text-[#8a1c1c]")}>
                  {formatClock(inSection)} / {formatClock(planned)}
                </span>
                <span aria-hidden className="h-1.5 w-32 overflow-hidden rounded-full bg-cream">
                  <span className="block h-full bg-gold" style={{ width: `${planned ? Math.min(100, (inSection / planned) * 100) : 0}%` }} />
                </span>
                {live && (
                  <Button
                    variant="outline"
                    aria-label="Add 5 minutes to this section"
                    onClick={() => setExtras((x) => ({ ...x, [view]: (x[view] ?? 0) + 5 }))}
                  >
                    +5m
                  </Button>
                )}
                <span className="ml-auto flex flex-wrap items-center gap-2">
                  <Button disabled={index <= 0} onClick={() => go(index - 1)}>
                    ← {index > 0 ? agenda[index - 1].title.split("·").pop()?.trim() : "Back"}
                  </Button>
                  <Button variant="primary" disabled={index >= agenda.length - 1} onClick={() => go(index + 1)}>
                    {index < agenda.length - 1 ? agenda[index + 1].title.split("·").pop()?.trim() : "Done"} →
                  </Button>
                </span>
              </div>
            )}
            <div>
              <h2 className="m-0 text-xl font-bold">{view === "business-plan" ? "Business Plan" : view === "accountability" ? "Accountability Chart" : section?.title}</h2>
              <p className="m-0 mt-0.5 text-sm text-muted">{view === "business-plan" ? "Vision, core values and the 1- and 3-year picture. Edits save for everyone." : view === "accountability" ? "One name per seat. Changes save for the whole team." : hints[view]}</p>
            </div>

            <fieldset disabled={!!readOnly} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
            {bloom && view === "business-best" && <SegueQuestion value={typeof doc.segueQuestion === "string" ? doc.segueQuestion : ""} onChange={(v) => edit((d) => ({ ...d, segueQuestion: v }))} saveStatus={readOnly ? undefined : statusText(status)} />}
            {bloom && view === "conclude" && !timer.started && <LastMeetingConclusion last={last} />}
            {view === "business-best" && <BusinessBest attendees={attendees} onChange={(next) => edit((d) => ({ ...d, attendees: keepHiddenAttendees(d.attendees, next) }))} />}
            {view === "scorecard" && <Scorecard doc={doc} edit={edit} people={people} bloom={bloom} today={today} {...(bloom ? { wide: scorecardWide, onWide: setScorecardWide } : {})} salons={salonsFor(key)} />}
            {view === "rocks" && <Rocks rocks={doc.rocks} onChange={(rocks) => edit((d) => ({ ...d, rocks }))} people={people} ownerOptions={owners} today={today} saveStatus={statusText(status)} bloom={bloom} />}
            {view === "headlines" && <Headlines headlines={doc.headlines} onChange={(headlines) => edit((d) => ({ ...d, headlines }))} author={people[0] ?? ""} />}
            {view === "todos" && <Todos todos={doc.todos} onChange={(todos) => edit((d) => ({ ...d, todos }))} people={owners} today={today} bloom={bloom} />}
            {view === "ids" && <Ids doc={doc} edit={edit} session={timer.sessionId ?? "pending"} meetingKey={info.key} voter={{ id: viewer.id, name: viewer.name || viewer.label }} attendees={attendees} addedBy={myName} headlines={agenda.some((a) => a.key === "headlines")} rocks={agenda.some((a) => a.key === "rocks")} bloom={bloom} people={owners} />}
            {view === "conclude" && !(bloom && !timer.started) && (
              <Conclude
                meetingKey={info.key}
                doc={doc}
                attendees={raters}
                me={meListed || myName}
                edit={edit}
                // Only the row pressed changes (read from the latest document, so two people rating at once both keep theirs).
                onRate={(id, rating) =>
                  edit((d) => {
                    const rows = ratingAttendees(effectiveAttendees(roster, d.attendees ?? []), d.attendees ?? [], meListed);
                    const row = rows.find((a) => a.id === id);
                    return row ? { ...d, attendees: keepHiddenAttendees(d.attendees ?? [], rows.map((a) => (a.id === id ? { ...a, rating } : a))) } : d;
                  })
                }
                end={endFn}
                flushNow={flushNow}
                sessionKey={timer.sessionId ?? "pending"}
                fixedSessionId={timer.sessionId}
                durationSeconds={elapsed}
                onEnded={() => setTimer((t) => endedTimer(t, serverNow()))}
                recapsHref={`/meetings/${info.key}/recaps`}
              />
            )}
            {reference && view === "business-plan" && <BusinessPlan meetingName={info.name} doc={doc} edit={edit} today={today} />}
            {reference && view === "accountability" && <AccountabilityChart seats={doc.seats} onChange={(seats) => edit((d) => ({ ...d, seats }))} />}
            </fieldset>

          </div>
        </div>
      )}

      {/* Room at the bottom so the floating Add to IDS button never covers the last rows. */}
      <div aria-hidden className="h-20" />
      {!readOnly && bloom && (
        <NewIssueButton
          open={parkOpen}
          setOpen={setParkOpen}
          people={owners}
          me={myName}
          onAdd={(title, owner) => edit((d) => ({ ...d, issues: [...d.issues, { id: newItemId(), title, notes: "", resolved: false, owner, ...(myName ? { addedBy: myName } : {}) }] }))}
        />
      )}
      {!readOnly && !bloom && <ParkIt open={parkOpen} setOpen={setParkOpen} onPark={(title) => edit((d) => ({ ...d, issues: [...d.issues, { id: newItemId(), title, notes: "", resolved: false, ...(myName ? { addedBy: myName } : {}) }] }))} />}
    </MentionRoster>
  );
}
