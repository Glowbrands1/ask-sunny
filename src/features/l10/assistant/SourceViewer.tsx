"use client";
// Copied from the Leadership Hub (src/components/assistant/SourceViewer.tsx); keep in step with it.

import Link from "next/link";
import { cellText, flattenRow, humanKey, tableColumns, type ReportCitation } from "./citations";
import { cx } from "@/features/l10/ui/ui";

/**
 * Shows exactly what a report tool returned, inside the chat, so a person can check the figures the answer was built on
 * without leaving the conversation. Generic on purpose: every tool returns plain JSON (objects, arrays, primitives).
 */
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isObjArray = (v: unknown): v is Record<string, unknown>[] => Array.isArray(v) && v.length > 0 && v.every(isObj);
const hasNestedList = (rows: Record<string, unknown>[]) => rows.some((r) => Object.values(r).some(isObjArray));
const MAX_ROWS = 200;

function Table({ rows }: { rows: Record<string, unknown>[] }) {
  const flat = rows.slice(0, MAX_ROWS).map(flattenRow);
  const cols = tableColumns(flat);
  return (
    <div className="overflow-x-auto rounded-lg ring-1 ring-gold/40">
      <table className="w-full border-collapse text-left text-xs">
        <thead className="bg-sunny/70">
          <tr>{cols.map((c) => <th key={c} scope="col" className="whitespace-nowrap px-2 py-1.5 font-semibold">{c}</th>)}</tr>
        </thead>
        <tbody>
          {flat.map((r, i) => (
            <tr key={i} className="border-t border-gold/25 align-top">
              {cols.map((c) => <td key={c} className="px-2 py-1.5 tabular-nums">{cellText(r[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX_ROWS ? <p className="m-0 px-2 py-1 text-xs text-muted">Showing the first {MAX_ROWS} of {rows.length} rows.</p> : null}
    </div>
  );
}

function Block({ value, depth }: { value: unknown; depth: number }) {
  if (isObjArray(value)) {
    // A list whose items hold their own lists (e.g. each metric with its salons): one titled section per item.
    if (hasNestedList(value) && depth < 3) {
      return (
        <div className="grid gap-3">
          {value.map((item, i) => {
            const title = Object.values(item).find((v) => typeof v === "string") as string | undefined;
            return (
              <div key={i}>
                {title ? <p className="m-0 mb-1 text-xs font-semibold">{title}</p> : null}
                <Fields obj={item} depth={depth + 1} skipTitle={title} />
              </div>
            );
          })}
        </div>
      );
    }
    return <Table rows={value} />;
  }
  if (isObj(value)) return <Fields obj={value} depth={depth + 1} />;
  if (Array.isArray(value) && value.length === 0) return <span className="text-muted">None</span>;
  return <span>{cellText(value)}</span>;
}

function Fields({ obj, depth, skipTitle }: { obj: Record<string, unknown>; depth: number; skipTitle?: string }) {
  const entries = Object.entries(obj).filter(([, v]) => v !== skipTitle);
  const simple = entries.filter(([, v]) => !isObjArray(v) && !isObj(v));
  const complex = entries.filter(([, v]) => isObjArray(v) || isObj(v));
  return (
    <div className="grid gap-2">
      {simple.length ? (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {simple.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{humanKey(k)}</dt>
              <dd className="m-0 break-words">{cellText(v)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {complex.map(([k, v]) => (
        <section key={k} className="grid gap-1">
          <h4 className="m-0 text-xs font-semibold uppercase tracking-wide text-bronze-deep">{humanKey(k)}</h4>
          <Block value={v} depth={depth} />
        </section>
      ))}
    </div>
  );
}

export function SourceViewer({ citation, onClose }: { citation: ReportCitation; onClose: () => void }) {
  return (
    <div data-testid="source-viewer" className="mt-2 grid gap-2 rounded-xl bg-white/80 p-3 ring-1 ring-gold/50">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-sm font-semibold">What I read: {citation.source}</p>
        <div className="flex items-center gap-2 text-xs">
          <Link href={citation.href} className="font-semibold text-bronze-deep underline">Open page</Link>
          <button type="button" onClick={onClose} className="rounded px-1.5 py-0.5 font-semibold text-muted hover:text-ink">Close</button>
        </div>
      </div>
      {citation.sample ? (
        <p className={cx("m-0 rounded-lg bg-gold-head/30 px-2 py-1 text-xs")}>Sample data: this page is still a demo, not your real figures.</p>
      ) : null}
      <div className="max-h-96 overflow-auto">
        {citation.data === undefined ? <p className="m-0 text-xs text-muted">No details were returned.</p> : <Block value={citation.data} depth={0} />}
      </div>
    </div>
  );
}
