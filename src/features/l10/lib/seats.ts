// Copied from the Leadership Hub (src/lib/meetings/seats.ts); keep in step with it. See src/features/l10/README.md.
/**
 * A meeting's accountability chart: the `seats` list in the meeting document, as Lovable stored it
 * (flat, each seat pointing at its parent). Unknown fields on a seat are kept as they are.
 */
export interface Seat {
  id: string;
  title: string;
  name: string;
  responsibilities: string[];
  parentId: string | null;
  [extra: string]: unknown;
}

export function readSeats(raw: unknown): Seat[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && typeof (s as { id?: unknown }).id === "string")
    .map((s) => ({
      ...s,
      id: s.id as string,
      title: typeof s.title === "string" ? s.title : "",
      name: typeof s.name === "string" ? s.name : "",
      responsibilities: Array.isArray(s.responsibilities) ? s.responsibilities.filter((r): r is string => typeof r === "string") : [],
      parentId: typeof s.parentId === "string" ? s.parentId : null,
    }));
}

export function childrenOf(seats: Seat[], parentId: string | null): Seat[] {
  return seats.filter((s) => s.parentId === parentId);
}

export function addSeat(seats: Seat[], parentId: string | null, title: string, id: string): Seat[] {
  const t = title.trim();
  if (!t) return seats;
  return [...seats, { id, title: t, name: "", responsibilities: [], parentId }];
}

export function patchSeat(seats: Seat[], id: string, fields: Partial<Seat>): Seat[] {
  return seats.map((s) => (s.id === id ? { ...s, ...fields } : s));
}

/** Removes a seat and everything that reports to it. */
export function removeSeat(seats: Seat[], id: string): Seat[] {
  const doomed = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of seats) {
      if (s.parentId && doomed.has(s.parentId) && !doomed.has(s.id)) {
        doomed.add(s.id);
        grew = true;
      }
    }
  }
  return seats.filter((s) => !doomed.has(s.id));
}

export function addResponsibility(seats: Seat[], id: string, text: string): Seat[] {
  const t = text.trim();
  if (!t) return seats;
  return seats.map((s) => (s.id === id ? { ...s, responsibilities: [...s.responsibilities, t] } : s));
}

export function removeResponsibility(seats: Seat[], id: string, index: number): Seat[] {
  return seats.map((s) => (s.id === id ? { ...s, responsibilities: s.responsibilities.filter((_, i) => i !== index) } : s));
}
