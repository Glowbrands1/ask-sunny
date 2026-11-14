"use client";
// Copied from the Leadership Hub (src/app/meetings/_components/Scorecard.tsx); keep in step with it. See src/features/l10/README.md.

import { useState } from "react";
import { Button, cx, inputClass } from "@/features/l10/ui/ui";
import { addWeek, cellTone, formatValue, newestFirst, newItemId, parseCell, setCell, shortDate, type CellTone } from "@/features/l10/lib/doc";
import type { MeetingDoc, MetricFormat, ScorecardRow } from "@/features/l10/lib/types";

const TONE: Record<CellTone, string> = {
  empty: "text-muted",
  negative: "font-semibold text-red-700",
  bad: "font-semibold text-red-700",
  near: "text-ink",
  good: "font-semibold text-green-700",
};

function Cell({ row, week, label, onCommit }: { row: ScorecardRow; week: number; label: string; onCommit: (v: number | null) => void }) {
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
      className={cx("min-h-9 w-full min-w-[64px] rounded-md px-1.5 py-1 text-right font-mono text-sm whitespace-nowrap hover:ring-2 hover:ring-gold/60", TONE[tone])}
    >
      {formatValue(value, row.format)}
    </button>
  );
}

export function Scorecard({ doc, edit, people }: { doc: MeetingDoc; edit: (fn: (d: MeetingDoc) => MeetingDoc) => void; people: string[] }) {
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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-sm text-muted print:hidden">Most recent week first. Tap any cell to edit.</p>
        <Button variant="outline" className="print:hidden" onClick={() => edit(addWeek)}>
          Add week
        </Button>
      </div>
      {doc.scorecard.length === 0 ? (
        <p className="m-0 rounded-[10px] border border-dashed border-line p-4 text-sm text-muted">No metrics yet. Add the first one below.</p>
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
      <div className="rounded-[10px] border border-dashed border-line bg-cream/60 p-3 print:hidden">
        <div className="mb-2 text-xs font-bold text-muted">Add metric</div>
        <div className="flex flex-wrap items-center gap-2">
          <input aria-label="Metric name" value={metric} onChange={(e) => setMetric(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addMetric()} placeholder="Metric name…" className={cx(inputClass, "min-w-[220px] flex-1")} />
          <select aria-label="Metric owner" value={owner} onChange={(e) => setOwner(e.target.value)} className={cx(inputClass, "w-44")}>
            {people.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <input aria-label="Goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Goal, e.g. ≥ 7%" className={cx(inputClass, "w-36")} />
          <select aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value as MetricFormat)} className={cx(inputClass, "w-32")}>
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
    </div>
  );
}

const tableHead = "bg-ink text-xs font-bold tracking-[0.06em] text-gold-head";
