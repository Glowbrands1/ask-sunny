// Copied from the Leadership Hub (src/lib/meetings/changes.ts); keep in step with it. See src/features/l10/README.md.
/**
 * A short plain-language account of what changed between two saved versions of a meeting document, for the version
 * history screen. Counts only (never the text of anything), computed from the two documents on the server.
 */
type Doc = Record<string, unknown>;
type Item = { id?: unknown; [k: string]: unknown };

const list = (d: Doc | null | undefined, key: string): Item[] => (Array.isArray(d?.[key]) ? (d![key] as Item[]).filter((x) => x && typeof x === "object") : []);
const ids = (xs: Item[]) => new Set(xs.map((x) => String(x.id ?? "")).filter(Boolean));
const byId = (xs: Item[]) => new Map(xs.map((x) => [String(x.id ?? ""), x]));
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function added<T extends Item>(prev: T[], next: T[]): T[] {
  const had = ids(prev);
  return next.filter((x) => !had.has(String(x.id ?? "")));
}
function removed<T extends Item>(prev: T[], next: T[]): T[] {
  return added(next, prev);
}
/** Items present in both versions whose `pick` value differs. */
function changed(prev: Item[], next: Item[], pick: (x: Item) => unknown): Item[] {
  const before = byId(prev);
  return next.filter((x) => before.has(String(x.id ?? "")) && !same(pick(before.get(String(x.id ?? ""))!), pick(x)));
}

const filePaths = (issues: Item[]) => new Set(issues.flatMap((i) => (Array.isArray(i.files) ? (i.files as { path?: unknown }[]).map((f) => String(f?.path ?? "")) : [])).filter(Boolean));

function scorecardCells(prev: Item[], next: Item[]): number {
  const before = byId(prev);
  let n = 0;
  for (const row of next) {
    const old = before.get(String(row.id ?? ""));
    if (!old) continue;
    const a = Array.isArray(old.weeks) ? old.weeks : [];
    const b = Array.isArray(row.weeks) ? row.weeks : [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (!same(a[i], b[i])) n++;
  }
  return n;
}

/** What changed from `prev` to `next` as a list of short phrases; empty when nothing a person would notice changed. */
export function changeParts(prev: Doc | null | undefined, next: Doc): string[] {
  const parts: string[] = [];
  const push = (n: number, one: string, many?: string) => n > 0 && parts.push(plural(n, one, many));

  const pi = list(prev, "issues");
  const ni = list(next, "issues");
  push(added(pi, ni).length, "issue added", "issues added");
  const solved = changed(pi, ni, (x) => !!x.resolved).filter((x) => x.resolved).length;
  const reopened = changed(pi, ni, (x) => !!x.resolved).filter((x) => !x.resolved).length;
  push(solved, "issue solved", "issues solved");
  push(reopened, "issue reopened", "issues reopened");
  push(removed(pi, ni).length, "issue deleted", "issues deleted");
  push(changed(pi, ni, (x) => x.rank ?? null).length, "issue re-ranked", "issues re-ranked");
  push(changed(pi, ni, (x) => x.notes ?? "").length, "issue's notes edited", "issues' notes edited");

  const pt = list(prev, "todos");
  const nt = list(next, "todos");
  push(added(pt, nt).length, "to-do added", "to-dos added");
  push(changed(pt, nt, (x) => !!x.done).filter((x) => x.done).length, "to-do done", "to-dos done");
  push(removed(pt, nt).length, "to-do deleted", "to-dos deleted");

  const pr = list(prev, "rocks");
  const nr = list(next, "rocks");
  push(added(pr, nr).length, "rock added", "rocks added");
  push(changed(pr, nr, (x) => x.status).length, "rock status changed", "rock statuses changed");
  push(changed(pr, nr, (x) => !!x.archived).filter((x) => x.archived).length, "rock archived", "rocks archived");
  push(removed(pr, nr).length, "rock deleted", "rocks deleted");
  const ms = (rocks: Item[]) => rocks.flatMap((r) => (Array.isArray(r.milestones) ? (r.milestones as Item[]) : []));
  const doneMs = changed(ms(pr), ms(nr), (x) => !!x.done).filter((x) => x.done).length;
  push(doneMs, "milestone done", "milestones done");

  const ph = list(prev, "headlines");
  push(added(ph, list(next, "headlines")).length, "headline added", "headlines added");

  push(scorecardCells(list(prev, "scorecard"), list(next, "scorecard")), "scorecard cell changed", "scorecard cells changed");
  push(added(list(prev, "scorecard"), list(next, "scorecard")).length, "metric added", "metrics added");
  push(removed(list(prev, "scorecard"), list(next, "scorecard")).length, "metric removed", "metrics removed");

  const attached = [...filePaths(ni)].filter((p) => !filePaths(pi).has(p)).length;
  push(attached, "file attached", "files attached");

  if (!same(prev?.vto, next.vto)) parts.push("business plan edited");
  if (!same(prev?.seats, next.seats)) parts.push("accountability chart edited");
  if (!same(prev?.cascade ?? "", next.cascade ?? "")) parts.push("cascading message edited");
  if (!same(prev?.attendees, next.attendees)) parts.push("attendees or ratings changed");
  return parts;
}

/** One sentence for the history list. */
export function summarizeChange(prev: Doc | null | undefined, next: Doc): string {
  if (prev === undefined) return "First version";
  if (prev === null) return "Earlier version not available";
  const parts = changeParts(prev, next);
  if (parts.length) return parts.map((p, i) => (i === 0 ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join(", ");
  return same(prev.timer, next.timer) ? "No visible change" : "Meeting clock or leader only";
}
