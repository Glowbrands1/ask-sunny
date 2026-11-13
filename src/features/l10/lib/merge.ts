// Copied from the Leadership Hub (src/lib/meetings/merge.ts); keep in step with it. See src/features/l10/README.md.
/**
 * Three-way merge for a stale save. `base` is the version this person started from,
 * `local` is what they have now, `remote` is what someone else saved meanwhile.
 *
 * Their change is kept wherever nobody else touched the same thing. Lists of items
 * with ids are merged item by item, so two people working on different issues never
 * collide. Where both changed the same value, it is reported as a conflict and the
 * remote value is used until the person chooses.
 */
export interface MergeResult {
  merged: unknown;
  /** Plain-language places where both people changed the same thing. */
  conflicts: string[];
}

type Json = unknown;

const isObject = (v: Json): v is Record<string, Json> => !!v && typeof v === "object" && !Array.isArray(v);
const equal = (a: Json, b: Json) => JSON.stringify(a) === JSON.stringify(b);
const hasIds = (a: Json[]) => a.length > 0 && a.every((x) => isObject(x) && typeof x.id === "string");

export type Prefer = "remote" | "local";

export function mergeThreeWay(base: Json, local: Json, remote: Json, path = "", prefer: Prefer = "remote"): MergeResult {
  if (equal(local, base)) return { merged: remote, conflicts: [] };
  if (equal(remote, base) || equal(local, remote)) return { merged: local, conflicts: [] };

  if (isObject(local) && isObject(remote)) {
    const b = isObject(base) ? base : {};
    const keys = new Set([...Object.keys(remote), ...Object.keys(local)]);
    const merged: Record<string, Json> = {};
    const conflicts: string[] = [];
    for (const k of keys) {
      const r = mergeThreeWay(b[k], local[k], remote[k], path ? `${path} › ${k}` : k, prefer);
      conflicts.push(...r.conflicts);
      if (r.merged !== undefined) merged[k] = r.merged;
    }
    return { merged, conflicts };
  }

  if (Array.isArray(local) && Array.isArray(remote)) {
    const b = Array.isArray(base) ? base : [];
    if (hasIds([...local, ...remote]) && (b.length === 0 || hasIds(b))) return mergeById(b, local, remote, path, prefer);
    if (local.length === remote.length && b.length === local.length) {
      const out: Json[] = [];
      const conflicts: string[] = [];
      for (let i = 0; i < local.length; i++) {
        const r = mergeThreeWay(b[i], local[i], remote[i], `${path} [${i + 1}]`, prefer);
        out.push(r.merged);
        conflicts.push(...r.conflicts);
      }
      return { merged: out, conflicts };
    }
  }

  return { merged: prefer === "local" ? local : remote, conflicts: [path || "this meeting"] };
}

function mergeById(base: Json[], local: Json[], remote: Json[], path: string, prefer: Prefer): MergeResult {
  const id = (x: Json) => (x as { id: string }).id;
  const byId = (a: Json[]) => new Map(a.map((x) => [id(x), x]));
  const b = byId(base);
  const l = byId(local);
  const r = byId(remote);
  const label = (x: Json) => {
    const o = x as Record<string, unknown>;
    return String(o.title ?? o.metric ?? o.text ?? o.name ?? o.id);
  };

  const order: string[] = [...r.keys(), ...[...l.keys()].filter((k) => !r.has(k))];
  const merged: Json[] = [];
  const conflicts: string[] = [];

  for (const k of order) {
    const inB = b.has(k);
    const inL = l.has(k);
    const inR = r.has(k);
    if (inL && inR) {
      const res = mergeThreeWay(b.get(k), l.get(k), r.get(k), `${path} › ${label(r.get(k))}`, prefer);
      merged.push(res.merged);
      conflicts.push(...res.conflicts);
    } else if (inR && !inL) {
      if (!inB) {
        // Someone else added it.
        merged.push(r.get(k));
      } else if (!equal(b.get(k), r.get(k))) {
        // I removed it, but someone else changed it meanwhile.
        if (prefer === "remote") merged.push(r.get(k));
        conflicts.push(`${path} › ${label(r.get(k))} (you removed it, someone else changed it)`);
      }
      // else: I removed it and nobody touched it, so it stays removed.
    } else if (inL && !inR) {
      // Someone else removed it. Keep mine only if it is new or I changed it.
      if (!inB) merged.push(l.get(k));
      else if (!equal(b.get(k), l.get(k))) {
        if (prefer === "local") merged.push(l.get(k));
        conflicts.push(`${path} › ${label(l.get(k))} (someone else removed it, you changed it)`);
      }
    }
  }
  return { merged, conflicts };
}
