"use client";
// Copied from the Leadership Hub (src/app/meetings/_components/Scorecard.tsx); keep in step with it. See src/features/l10/README.md.

import { useState } from "react";
import { Button, cx, inputClass } from "@/features/l10/ui/ui";
import { inWeek, initials, ownerColor, weekBounds, weekRange } from "@/features/l10/lib/bloom";
import { addWeek, cellTone, formatValue, newestFirst, newItemId, parseCell, setCell, shortDate, type CellTone } from "@/features/l10/lib/doc";
import type { MeetingDoc, MetricFormat, ScorecardRow } from "@/features/l10/lib/types";

const TONE: Record<CellTone, string> = {
  empty: "text-muted",
  negative: "font-semibold text-red-700",
  bad: "font-semibold text-red-700",
  near: "text-ink",
  good: "font-semibold text-green-700",
};

/** Bloom-style cells (the DM L10s): tinted green on goal, red off goal, and an empty box for a week not entered yet. */
const BLOOM_TONE: Record<CellTone, string> = {
  empty: "border border-dashed border-line bg-white text-muted",
  negative: "bg-[#fbe4e4] font-semibold text-[#8a1c1c]",
  bad: "bg-[#fbe4e4] font-semibold text-[#8a1c1c]",
  near: "bg-[#fbe4e4] text-[#8a1c1c]",
  good: "bg-[#e1f1e4] font-semibold text-[#154a21]",
};

function Cell({ row, week, label, onCommit, bloom = false }: { row: ScorecardRow; week: number; label: string; onCommit: (v: number | null) => void; bloom?: boolean }) {
  const value = row.weeks[week] ?? null;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (editing) {
    const done = () => {
      const parsed = parseCell(draft);
      if (parsed.ok && parsed.value !== value) onCommit(parsed.value);
      setEditing(false);
    };
    return (
      <input
        autoFocus
        aria-label={`${row.metric} ${label}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => {
          if (e.key === "Enter") done();
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-9 w-[72px] rounded-md border border-bronze bg-white px-1.5 text-right font-mono text-sm"
      />
    );
  }
  const tone = cellTone(row, value);
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value == null ? "" : String(value));
        setEditing(true);
      }}
      aria-label={`${row.metric} ${label}: ${formatValue(value, row.format)}`}
      data-tone={tone}
      className={cx("min-h-9 w-full min-w-[64px] rounded-md px-1.5 py-1 text-right font-mono text-sm whitespace-nowrap hover:ring-2 hover:ring-gold/60", bloom ? BLOOM_TONE[tone] : TONE[tone])}
    >
      {bloom && value == null ? "" : formatValue(value, row.format)}
    </button>
  );
}

export function Scorecard({ doc, edit, people, bloom = false, today = "" }: { doc: MeetingDoc; edit: (fn: (d: MeetingDoc) => MeetingDoc) => void; people: string[]; /** Laid out like Bloom Growth's scorecard (the DM L10s). */ bloom?: boolean; today?: string }) {
  const order = newestFirst(doc);
  const [metric, setMetric] = useState("");
  const [owner, setOwner] = useState(people[0] ?? "");
  const [goal, setGoal] = useState("");
  const [format, setFormat] = useState<MetricFormat>("percent");
  const [higher, setHigher] = useState(true);

  const addMetric = () => {
    if (!metric.trim()) return;
    const goalValue = Number(goal.replace(/[^0-9.-]/g, "")) || 0;
    const row: ScorecardRow = {
      id: newItemId(),
      metric: metric.trim(),
      owner,
      goal: goal.trim() || `${higher ? "≥" : "≤"} ${goalValue}`,
      goalValue,
      higherIsBetter: higher,
      format,
      weeks: doc.weekEndings.map(() => null),
    };
    edit((d) => ({ ...d, scorecard: [...d.scorecard, row] }));
    setMetric("");
    setGoal("");
  };

  const form = (
    <div className="rounded-[10px] border border-dashed border-line bg-cream/60 p-3 print:hidden" data-testid="add-metric">
      <div className="mb-2 text-xs font-bold text-muted">Add metric</div>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Metric name" value={metric} onChange={(e) => setMetric(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addMetric()} placeholder="Metric name…" className={cx(inputClass, "min-w-[220px] flex-1")} />
        <select aria-label="Metric owner" value={owner} onChange={(e) => setOwner(e.target.value)} className={cx(inputClass, "w-44")}>
          {people.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <input aria-label="Goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Goal, e.g. ≥ 7%" className={cx(inputClass, "w-36")} />
        <select aria-label="Format" title="Unit" value={format} onChange={(e) => setFormat(e.target.value as MetricFormat)} className={cx(inputClass, "w-32")}>
          <option value="percent">Percent</option>
          <option value="currency">Currency</option>
          <option value="number">Number</option>
        </select>
        <select aria-label="Direction" value={higher ? "higher" : "lower"} onChange={(e) => setHigher(e.target.value === "higher")} className={cx(inputClass, "w-36")}>
          <option value="higher">Higher is better</option>
          <option value="lower">Lower is better</option>
        </select>
        <Button variant="primary" disabled={!metric.trim()} onClick={addMetric}>
          Add metric
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Bloom-style: "Add metric" at the top, above the table, like "Add new rock" (the owner's request, 15 Nov 2026). */}
      {bloom && form}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-sm text-muted print:hidden">Most recent week first. Tap any cell to edit.</p>
        <Button variant="outline" className="print:hidden" onClick={() => edit(addWeek)}>
          Add week
        </Button>
      </div>
      {doc.scorecard.length > 0 && bloom ? (
        <BloomTable doc={doc} edit={edit} order={order} today={today} />
      ) : doc.scorecard.length === 0 ? (
        <p className="m-0 rounded-[10px] border border-dashed border-line p-4 text-sm text-muted">No metrics yet. Add the first one {bloom ? "above" : "below"}.</p>
      ) : (
        <div className="overflow-x-auto rounded-[10px] border border-line bg-white shadow-card">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className={tableHead}>
                <th className="sticky left-0 z-10 bg-ink px-4 py-2.5 text-left">Metric</th>
                <th className="px-3 py-2.5 text-left">Owner</th>
                <th className="px-3 py-2.5 text-left">Goal</th>
                {order.map((i) => (
                  <th key={i} className="px-2 py-2.5 text-right font-mono">
                    {shortDate(doc.weekEndings[i])}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {doc.scorecard.map((r) => (
                <tr key={r.id} className="border-t border-rule">
                  <td className="sticky left-0 z-10 min-w-[170px] bg-white px-4 py-2 font-semibold">
                    <span className="flex items-center justify-between gap-2">
                      {r.metric}
                      <button
                        type="button"
                        aria-label={`Remove metric ${r.metric}`}
                        title="Remove metric"
                        className="rounded px-1 text-xs text-muted hover:bg-cream hover:text-[#8a1c1c] print:hidden"
                        onClick={() => edit((d) => ({ ...d, scorecard: d.scorecard.filter((x) => x.id !== r.id) }))}
                      >
                        ✕
                      </button>
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted">{r.owner}</td>
                  <td className="px-3 py-2 font-mono whitespace-nowrap text-muted">{r.goal}</td>
                  {order.map((i) => (
                    <td key={i} className="px-1 py-1">
                      <Cell row={r} week={i} label={shortDate(doc.weekEndings[i]) || `week ${i + 1}`} onCommit={(v) => edit((d) => setCell(d, r.id, i, v))} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!bloom && form}
    </div>
  );
}

const tableHead = "bg-ink text-xs font-bold tracking-[0.06em] text-gold-head";

/**
 * The scorecard as Bloom Growth lays it out (the DM L10s; the owner's request, 15 Nov 2026): Who (the owner's initials,
 * full name on hover), Metric, Goal, then the weeks newest first, each headed by its range ("2 Nov / 8 Nov") with this
 * week shaded. Rows are grouped by owner with a gap between groups; older weeks scroll sideways. Same cells, same saves.
 */
function BloomTable({ doc, edit, order, today }: { doc: MeetingDoc; edit: (fn: (d: MeetingDoc) => MeetingDoc) => void; order: number[]; today: string }) {
  const groups = new Map<string, ScorecardRow[]>();
  for (const r of doc.scorecard) groups.set(r.owner, [...(groups.get(r.owner) ?? []), r]);
  const current = (i: number) => inWeek(doc.weekEndings[i], today);
  return (
    <div className="overflow-x-auto rounded-[10px] border border-line bg-white shadow-card" data-testid="bloom-scorecard">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className={tableHead}>
            <th scope="col" className="sticky left-0 z-10 w-12 bg-ink px-3 py-2.5 text-left">
              Who
            </th>
            <th scope="col" className="px-3 py-2.5 text-left">
              Metric
            </th>
            <th scope="col" className="px-3 py-2.5 text-left">
              Goal
            </th>
            {order.map((i) => (
              <th key={i} scope="col" data-current={current(i) ? "true" : undefined} data-current-week={current(i) ? "" : undefined} className="px-2 py-2 text-right font-mono leading-tight whitespace-nowrap">
                {(() => {
                  // Two lines, start over end ("9 Nov" / "15 Nov"); the slash is kept for screen readers.
                  const b = weekBounds(doc.weekEndings[i]);
                  if (!b) return weekRange(doc.weekEndings[i]);
                  return (
                    <>
                      <span className="block" data-week-start>
                        {b.start}
                      </span>
                      <span className="sr-only"> / </span>
                      <span className="block" data-week-end>
                        {b.end}
                      </span>
                    </>
                  );
                })()}
              </th>
            ))}
          </tr>
        </thead>
        {[...groups].map(([owner, rows]) => (
          <tbody key={owner} aria-label={`${owner}'s metrics`} className="border-t-[10px] border-cream first-of-type:border-t-0">
            {rows.map((r) => (
              <tr key={r.id} data-owner-row={ownerColor(owner)} className="border-t border-rule">
                <td className="sticky left-0 z-10 bg-white px-3 py-2">
                  <span title={owner} data-owner-color={ownerColor(owner)} className="flex size-8 items-center justify-center rounded-full text-[11px] font-bold">
                    <span aria-hidden>{initials(owner)}</span>
                    <span className="sr-only">{owner}</span>
                  </span>
                </td>
                <td className="min-w-[170px] px-3 py-2 font-semibold">
                  <span className="flex items-center justify-between gap-2">
                    {r.metric}
                    <button
                      type="button"
                      aria-label={`Remove metric ${r.metric}`}
                      title="Remove metric"
                      className="rounded px-1 text-xs text-muted hover:bg-cream hover:text-[#8a1c1c] print:hidden"
                      onClick={() => edit((d) => ({ ...d, scorecard: d.scorecard.filter((x) => x.id !== r.id) }))}
                    >
                      ✕
                    </button>
                  </span>
                </td>
                <td className="px-3 py-2 font-mono whitespace-nowrap text-muted">{r.goal}</td>
                {order.map((i) => (
                  <td key={i} data-current-week={current(i) ? "" : undefined} className="px-1 py-1">
                    <Cell bloom row={r} week={i} label={weekRange(doc.weekEndings[i]) || `week ${i + 1}`} onCommit={(v) => edit((d) => setCell(d, r.id, i, v))} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}
