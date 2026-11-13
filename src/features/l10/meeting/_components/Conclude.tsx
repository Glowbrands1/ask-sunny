"use client";
// Copied from the Leadership Hub (src/app/meetings/_components/Conclude.tsx); keep in step with it. See src/features/l10/README.md.

import { useRef, useState } from "react";
import Link from "next/link";
import { Button, Card, cx } from "@/features/l10/ui/ui";
import { MentionField, MentionText } from "@/features/l10/ui/Mentions";
import { buildRecap, markRecapped } from "@/features/l10/lib/doc";
import type { EndOutcome } from "@/features/l10/data.server";
import type { Attendee, MeetingDoc, RecapInput } from "@/features/l10/lib/types";

export type EndFn = (key: string, input: RecapInput) => Promise<EndOutcome>;

/** Concludes the meeting: outstanding to-dos, cascading message, ratings, then End meeting & save recap. */
export function Conclude({
  meetingKey,
  doc,
  attendees,
  edit,
  onRate,
  end,
  flushNow,
  sessionKey,
  fixedSessionId,
  durationSeconds,
  onEnded,
  recapsHref = "/meetings/recaps",
}: {
  /** Where "See recaps" goes (Ask Sunny: /meetings/<key>/recaps, this meeting's recaps page). */
  recapsHref?: string;
  meetingKey: string;
  doc: MeetingDoc;
  attendees: Attendee[];
  edit: (fn: (d: MeetingDoc) => MeetingDoc) => void;
  /** A number, or null to clear the person's rating (clicking the selected number again). */
  onRate: (id: string, rating: number | null) => void;
  end: EndFn;
  flushNow: () => Promise<boolean>;
  sessionKey: string;
  /** The running meeting's own session id, so everyone ending the same meeting saves one recap. */
  fixedSessionId?: string | null;
  durationSeconds: number;
  /** Called after the recap is saved, so the meeting can be marked over for everyone. */
  onEnded?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<null | { created: boolean }>(null);
  /** Said aloud by screen readers after a rating changes. */
  const [rateNote, setRateNote] = useState("");
  // One session id per attempt, so pressing End again after a failure saves the recap once.
  const sessionId = useRef<string | null>(null);

  const rated = attendees.filter((a) => a.rating != null);
  const avg = rated.length ? (rated.reduce((s, a) => s + (a.rating ?? 0), 0) / rated.length).toFixed(1) : null;
  const openTodos = doc.todos.filter((t) => !t.done);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!(await flushNow())) {
        setError("Your latest changes are not saved yet, so the recap was not saved. Try again in a moment.");
        return;
      }
      sessionId.current ??= fixedSessionId ?? new Date().toISOString();
      const id = sessionId.current;
      const res = await end(meetingKey, buildRecap(doc, attendees, sessionKey, id, durationSeconds));
      if (!res.ok) {
        setError(res.message);
        return;
      }
      edit((d) => ({ ...d, issues: markRecapped(d.issues, sessionKey, id) }));
      sessionId.current = null;
      setDone({ created: res.created });
      onEnded?.();
    } catch {
      setError("The recap was not saved. Nothing was lost: try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card aria-label="Recap">
          <h3 className="m-0 text-lg font-bold">Recap</h3>
          <p className="m-0 text-xs text-muted">Outstanding to-dos leaving this meeting</p>
          <ul className="m-0 mt-3 flex list-none flex-col gap-1.5 p-0">
            {openTodos.length === 0 && <li className="text-sm text-muted">No open to-dos.</li>}
            {openTodos.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 rounded-lg bg-cream px-3 py-2 text-sm">
                <span><MentionText text={t.text} /></span>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs text-muted">
                  {t.owner} · {t.dueDate ?? t.due}
                </span>
              </li>
            ))}
          </ul>
          <h4 className="m-0 mt-5 text-base font-bold">Cascading message</h4>
          <MentionField multiline aria-label="Cascading message" value={doc.cascade} onChange={(v) => edit((d) => ({ ...d, cascade: v }))} className="mt-2 min-h-[100px] py-2" />
        </Card>
        <Card aria-label="Ratings">
          <div className="flex items-end justify-between">
            <div>
              <h3 className="m-0 text-lg font-bold">Ratings</h3>
              <p className="m-0 text-xs text-muted">1 = poor, 10 = great</p>
            </div>
            <div className="text-right">
              <div className="text-4xl font-bold tabular-nums text-bronze-deep" data-testid="rating-average">
                {avg ?? "—"}
              </div>
              <div className="text-xs text-muted">
                avg · {rated.length}/{attendees.length}
              </div>
            </div>
          </div>
          <ul className="m-0 mt-4 flex list-none flex-col gap-3 p-0">
            {attendees.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <span className="w-36 truncate text-sm">{a.name}</span>
                <div role="group" aria-label={`Rating for ${a.name}`} className="flex min-w-[200px] flex-1 gap-1">
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-label={`${a.name}: ${n}`}
                      aria-pressed={a.rating === n}
                      title={a.rating === n ? "Click again to clear" : undefined}
                      onClick={() => {
                        const clear = a.rating === n;
                        onRate(a.id, clear ? null : n);
                        setRateNote(clear ? `Rating cleared for ${a.name}` : `${a.name} rated ${n}`);
                      }}
                      className={cx("h-8 min-w-6 flex-1 rounded text-xs font-bold", a.rating === n ? "bg-ink text-gold" : a.rating != null && n <= a.rating ? "bg-warn text-warn-ink" : "bg-cream text-muted hover:bg-warn/50")}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <p role="status" aria-live="polite" className="sr-only" data-testid="rating-note">
            {rateNote}
          </p>
        </Card>
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-line bg-white p-4 shadow-card">
        <Button variant="primary" disabled={busy} onClick={run}>
          {busy ? "Saving the recap…" : "End meeting & save recap"}
        </Button>
        {done && (
          <p role="status" className="m-0 text-sm font-semibold">
            {done.created ? "Meeting concluded. The recap is saved for the whole team." : "A recap for this meeting was already saved."}{" "}
            <Link href={recapsHref} className="text-bronze-deep underline">
              See recaps
            </Link>
          </p>
        )}
        {error && (
          <p role="alert" className="m-0 text-sm font-semibold text-[#8a1c1c]">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
