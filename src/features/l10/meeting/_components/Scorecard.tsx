"use client";
// Copied from the Leadership Hub (src/app/meetings/_components/Scorecard.tsx); keep in step with it. See src/features/l10/README.md.

import { useState } from "react";
import { Button, cx, inputClass } from "@/features/l10/ui/ui";
import { inWeek, initials, ownerColor, weekBounds, weekRange } from "@/features/l10/lib/bloom";
import { addWeek, cellTone, formatValue, newestFirst, newItemId, parseCell, setCell, shortDate, type CellTone } from "@/features/l10/lib/doc";
import type { MeetingDoc, MetricFormat, ScorecardRow } from "@/features/l10/lib/types";
import { SD_SALON_METRICS } from "@/features/l10/lib/config";

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

export function Scorecard({
  doc,
  edit,
  people,
  bloom = false,
  today = "",
  wide,
  onWide,
  salons = [],
}: {
  /**
   * Ask Sunny: the salons on this meeting's per-salon scorecard (the STC SD L10s: config.ts SD_DISTRICT_SALONS). With
   * any, the page offers "Set up the salon scorecard", and the table lists each salon with its DM.
   */
  salons?: readonly { number: string; name: string }[];
  doc: MeetingDoc;
  edit: (fn: (d: MeetingDoc) => MeetingDoc) => void;
  people: string[];
  /** Laid out like Bloom Growth's scorecard (the DM L10s). */
  bloom?: boolean;
  today?: string;
  /** Port from Ask Bubbles: the table uses the whole page (the agenda column hidden); with `onWide`, a Full width / Collapse button. */
  wide?: boolean;
  onWide?: (wide: boolean) => void;
}) {
  const order = newestFirst(doc);
  const [metric, setMetric] = useState("");
  const [owner, setOwner] = useState(people[0] ?? "");
  const [goal, setGoal] = useState("");
  const [format, setFormat] = useState<MetricFormat>("percent");
  const [higher, setHigher] = useState(true);
  /*
   * Port from Ask Bubbles, Bloom-style: the form is closed until "Add metric" is pressed, a button next to "Add week"
   * (the owner, 18 Nov 2026: "make this collapasable"; the same request as the sibling app's).
   */
  const [adding, setAdding] = useState(false);
  const missingSalons = salons.filter((s) => !doc.scorecard.some((r) => r.salon === s.name));

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
      <div className="mb-2 flex items-center justify-between gap-2 text-xs font-bold text-muted">
        Add metric
        {bloom && (
          <Button variant="link" onClick={() => setAdding(false)}>
            Done
          </Button>
        )}
      </div>
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
      {bloom ? (
        /*
         * Port from Ask Bubbles: the buttons first, on the left, where they are seen (the owner, 18 Nov 2026: 'make "add a
         * week" button visible please'; it sat at the far right). On a phone they wrap.
         */
        <div className="flex flex-wrap items-center gap-2 print:hidden" data-testid="scorecard-toolbar">
          <Button variant="primary" onClick={() => edit(addWeek)}>
            + Add week
          </Button>
          <Button variant="outline" aria-expanded={adding} aria-controls="add-metric-form" onClick={() => setAdding((a) => !a)}>
            Add metric
          </Button>
          {onWide && (
            <Button variant="outline" aria-pressed={!!wide} title={wide ? "Show the agenda again" : "Hide the agenda so the table uses the whole page"} onClick={() => onWide(!wide)}>
              {wide ? "⤡ Collapse" : "⤢ Full width"}
            </Button>
          )}
          <p className="m-0 basis-full text-sm text-muted sm:ml-auto sm:basis-auto">Most recent week first. Tap any cell to edit.</p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="m-0 text-sm text-muted print:hidden">Most recent week first. Tap any cell to edit.</p>
          <Button variant="outline" className="print:hidden" onClick={() => edit(addWeek)}>
            Add week
          </Button>
        </div>
      )}
      {/* Bloom-style: the form opens above the table when "Add metric" is pressed. */}
      {bloom && missingSalons.length > 0 && (
        <SalonSetup salons={missingSalons} people={people} onAdd={(rows) => edit((d) => ({ ...d, scorecard: [...d.scorecard, ...rows.map((r): ScorecardRow => ({ ...r, weeks: d.weekEndings.map(() => null) }))] }))} />
      )}
      {bloom && adding && <div id="add-metric-form">{form}</div>}
      {doc.scorecard.length > 0 && bloom ? (
        <BloomTable doc={doc} edit={edit} order={order} today={today} />
      ) : doc.scorecard.length === 0 ? (
        <p className="m-0 rounded-[10px] border border-dashed border-line p-4 text-sm text-muted">No metrics yet. {bloom ? "Press Add metric to add the first one." : "Add the first one below."}</p>
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
/** The Bloom-style header: white on black (the owner found the yellow header hard on the eyes, 16 Nov 2026). */
const bloomHead = "bg-ink text-xs font-bold tracking-[0.06em] text-white";

/**
 * The scorecard as Bloom Growth lays it out (the DM L10s; the owner's request, 15 Nov 2026): Who (the owner's initials,
 * full name on hover), Metric, Goal, then the weeks newest first, each headed by its range ("2 Nov / 8 Nov") with this
 * week shaded. Rows are grouped by owner with a gap between groups; older weeks scroll sideways. Same cells, same saves.
 */
function BloomTable({ doc, edit, order, today }: { doc: MeetingDoc; edit: (fn: (d: MeetingDoc) => MeetingDoc) => void; order: number[]; today: string }) {
  // Grouped by owner; a salon's metrics (the STC SD L10s) group under the salon instead, headed by its name and DM.
  const groups = new Map<string, ScorecardRow[]>();
  const groupOf = (r: ScorecardRow) => (typeof r.salon === "string" && r.salon ? `salon:${r.salon}` : r.owner);
  for (const r of doc.scorecard) groups.set(groupOf(r), [...(groups.get(groupOf(r)) ?? []), r]);
  const current = (i: number) => inWeek(doc.weekEndings[i], today);
  return (
    <div className="overflow-x-auto rounded-[10px] border border-line bg-white shadow-card" data-testid="bloom-scorecard">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className={bloomHead} data-testid="bloom-scorecard-head">
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
        {[...groups].map(([group, rows]) => {
          const salon = rows[0].salon;
          const owner = rows[0].owner;
          return (
          <tbody key={group} aria-label={salon ? `${salon} (${owner})` : `${owner}'s metrics`} className="border-t-[10px] border-cream first-of-type:border-t-0">
            {salon && (
              <tr data-salon-row className="bg-cream/70">
                <th scope="rowgroup" colSpan={3 + order.length} className="px-3 py-1.5 text-left text-sm">
                  <span className="sticky left-3 font-bold">{salon}</span>
                  <span className="sticky left-3 font-normal text-muted"> · DM: {owner}</span>
                </th>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} data-owner-row={ownerColor(owner)} className="border-t border-rule">
                <td className="sticky left-0 z-10 bg-white px-3 py-2">
                  <span title={owner} data-owner-color={ownerColor(owner)} className="flex size-8 items-center justify-center rounded-full text-[11px] font-bold">
                    <span aria-hidden>{initials(owner)}</span>
                    <span className="sr-only">{owner}</span>
                  </span>
                </td>
                <td className="min-w-[120px] px-3 py-2 font-semibold sm:min-w-[170px]">
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
          );
        })}
      </table>
    </div>
  );
}

/**
 * Ask Sunny: "Set up the salon scorecard" on an STC SD L10 (17 Nov 2026: "list each store individually with its assigned
 * DM"; the metrics "YOY Revenue, Club Close, PPTA, Spa per Unique, SMS Opt-in %"). Pick the DM, type each metric's goal
 * once, tick the salons: each ticked salon gets the five metrics, owned by that DM. Shown while a salon of the
 * district has no metrics yet; Add metric and the ✕ on each row work as for any metric.
 */
function SalonSetup({ salons, people, onAdd }: { salons: readonly { number: string; name: string }[]; people: string[]; onAdd: (rows: ScorecardRow[]) => void }) {
  const [dm, setDm] = useState(people[0] ?? "");
  const [goals, setGoals] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const chosen = salons.filter((s) => picked[s.number] !== false);
  const add = () => {
    const rows: ScorecardRow[] = [];
    for (const s of chosen)
      for (const m of SD_SALON_METRICS) {
        const typed = (goals[m.metric] ?? "").trim();
        const goalValue = Number(typed.replace(/[^0-9.-]/g, "")) || 0;
        rows.push({ id: newItemId(), metric: m.metric, owner: dm, goal: typed || "—", goalValue, higherIsBetter: true, format: m.format, weeks: [], salon: s.name });
      }
    if (rows.length) onAdd(rows);
  };
  return (
    <section aria-label="Set up the salon scorecard" className="flex flex-col gap-3 rounded-[10px] border border-dashed border-line bg-cream/60 p-3 print:hidden" data-testid="salon-setup">
      <div className="text-xs font-bold text-muted">Set up the salon scorecard: each salon with its DM and the five metrics</div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="DM for these salons" value={dm} onChange={(e) => setDm(e.target.value)} className={cx(inputClass, "w-48")}>
          {people.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        {SD_SALON_METRICS.map((m) => (
          <input key={m.metric} aria-label={`Goal for ${m.metric}`} value={goals[m.metric] ?? ""} onChange={(e) => setGoals((g) => ({ ...g, [m.metric]: e.target.value }))} placeholder={`${m.metric} goal`} className={cx(inputClass, "w-40")} />
        ))}
      </div>
      <fieldset className="m-0 flex flex-wrap gap-x-4 gap-y-1 border-0 p-0">
        <legend className="sr-only">Salons</legend>
        {salons.map((s) => (
          <label key={s.number} className="flex min-h-9 items-center gap-1.5 text-sm">
            <input type="checkbox" checked={picked[s.number] !== false} onChange={(e) => setPicked((p) => ({ ...p, [s.number]: e.target.checked }))} />
            {s.name}
          </label>
        ))}
      </fieldset>
      <div>
        <Button variant="primary" disabled={!chosen.length || !dm} onClick={add}>
          {`Add ${chosen.length} salon${chosen.length === 1 ? "" : "s"}`}
        </Button>
      </div>
    </section>
  );
}
