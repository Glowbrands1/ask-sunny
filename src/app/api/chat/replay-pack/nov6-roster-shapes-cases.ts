import { expect } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase } from "./cases";

/**
 * ============================================================================
 * EVERY ROSTER SHAPE, TYPED EVERY WAY (QA, 5–6 Nov 2026, for flip 3's name set)
 * ============================================================================
 *
 * Ported from the sibling app (Ask-bubbles#502). Both gates passed while the real rosters have name shapes the invented ones never had (QA's directory counts,
 * no names: two-word first names, preferred first names, surnames of three letters or fewer, two-word surnames,
 * a surname with an apostrophe or a dot). One invented person per shape, typed seven ways: exact, lowercase, first
 * name only, first name + last initial, a one-letter typo, two letters swapped, three letters rotated.
 *
 * The invariant: a roster person is never emptied away — the card is theirs, or the reply offers them by their
 * roster name ("Is this for …", "Did you mean …"). Statuses are from this app's run of 6 Nov 2026 (on #561, with this pull request's matcher):
 * with production's flags a misspelling stays on the card as typed (OPEN); the name set (FORM_NAME + NEAR_MISS +
 * IN_CANDIDATE + COMPOUND; NOT_FOUND_ANY is not in this app yet) is the fix, with this pull request's matcher. A variant
 * that leaves the name unchanged (a three-letter surname, a doubled letter) is left out. Every person invented
 * (checked against both apps' directories).
 */

const NAME_SET = [
  "FORM_NAME_FROM_ROSTER_ENABLED",
  "ROSTER_NEAR_MISS_ENABLED",
  "ROSTER_NAME_IN_CANDIDATE_ENABLED",
  "ROSTER_COMPOUND_SURNAME_ENABLED",
];

const person = (id: string, firstName: string, lastName: string, preferredFirstName: string | null = null): DirectoryRow => ({
  id,
  firstName,
  lastName,
  preferredFirstName,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
});

interface Shape {
  readonly key: string;
  readonly row: DirectoryRow;
  readonly first: string;
  readonly last: string;
}

const SHAPES: readonly Shape[] = [
  { key: "two-word-first", row: person("e-rosa-lind-thistlewood", "Rosa Lind", "Thistlewood"), first: "Rosa Lind", last: "Thistlewood" },
  { key: "preferred", row: person("e-bartholomew-quillfeather", "Bartholomew", "Quillfeather", "Bart"), first: "Bart", last: "Quillfeather" },
  { key: "short-surname", row: person("e-ilsabet-vey", "Ilsabet", "Vey"), first: "Ilsabet", last: "Vey" },
  { key: "compound-surname", row: person("e-severin-ashdown-ferrant", "Severin", "Ashdown Ferrant"), first: "Severin", last: "Ashdown Ferrant" },
  { key: "apostrophe", row: person("e-caoimhe-odallagher", "Caoimhe", "O'Dallagher"), first: "Caoimhe", last: "O'Dallagher" },
  { key: "dot", row: person("e-jules-st-aubrey", "Jules", "St. Aubrey"), first: "Jules", last: "St. Aubrey" },
];

const lastWord = (text: string) => text.split(" ").at(-1)!;
const onLast = (last: string, change: (word: string) => string) => last.replace(/\S+$/, (word) => change(word));
const typo = (word: string) => (word.length < 4 ? word : word.slice(0, 3) + (word[3] === "e" ? "a" : "e") + word.slice(4));
const swap = (word: string) => (word.length < 4 ? word : word.slice(0, 2) + word[3] + word[2] + word.slice(4));
const rotate = (word: string) => (word.length < 7 ? word : word.slice(0, 3) + word[5] + word[3] + word[4] + word.slice(6));

const VARIANTS: readonly { readonly key: string; readonly typed: (shape: Shape) => string }[] = [
  { key: "exact", typed: (s) => `${s.first} ${s.last}` },
  { key: "lowercase", typed: (s) => `${s.first} ${s.last}`.toLowerCase() },
  { key: "first-only", typed: (s) => s.first },
  { key: "first-initial", typed: (s) => `${s.first} ${lastWord(s.last)[0]}` },
  { key: "typo", typed: (s) => `${s.first} ${onLast(s.last, typo)}` },
  { key: "swap", typed: (s) => `${s.first} ${onLast(s.last, swap)}` },
  { key: "rotation", typed: (s) => `${s.first} ${onLast(s.last, rotate)}` },
];

/** With production's flags, 6 Nov 2026: the variants that already keep the roster person (card or asked). */
const HOLDS_IN_PRODUCTION = new Set([
  "two-word-first/exact",
  "two-word-first/lowercase",
  "two-word-first/first-only",
  "preferred/exact",
  "preferred/lowercase",
  "preferred/first-only",
  "short-surname/exact",
  "short-surname/lowercase",
  "short-surname/first-only",
  "compound-surname/exact",
  "compound-surname/lowercase",
  "compound-surname/first-only",
  "apostrophe/exact",
  "apostrophe/lowercase",
  "apostrophe/first-only",
  "dot/exact",
  "dot/lowercase",
  "dot/first-only",
  "dot/first-initial",
  "dot/typo",
  "dot/swap",
]);

/**
 * With the name set, 6 Nov 2026, the two shapes it emptied — "Rosa Lind T" (a two-word first name compared by its first
 * word only) and "Severin F" (an initial compared with the start of the whole surname only). Changed on purpose: both
 * now hold with ROSTER_COMPOUND_SURNAME_ENABLED, extended to compound first names and to an initial of any surname word.
 */
const EMPTIED_BY_THE_NAME_SET: Record<string, string> = {};

const cases: ReplayCase[] = [];
for (const shape of SHAPES) {
  const name = `${shape.row.firstName} ${shape.row.lastName}`;
  const preferred = shape.row.preferredFirstName ? `${shape.row.preferredFirstName} ${shape.row.lastName}` : null;
  for (const variant of VARIANTS) {
    const typed = variant.typed(shape);
    if (variant.key !== "exact" && variant.key !== "lowercase" && variant.key !== "first-only" && variant.key !== "first-initial" && typed === `${shape.first} ${shape.last}`) continue;
    const key = `${shape.key}/${variant.key}`;
    const emptied = EMPTIED_BY_THE_NAME_SET[key];
    cases.push({
      id: `nov6-roster-shape-${shape.key}-${variant.key}`,
      title: `${shape.key}, typed ${variant.key} ("${typed}"): the card is ${name}'s, or the reply offers ${name}; never emptied`,
      report: "QA, 5–6 Nov 2026: roster shapes the invented names never had, for flip 3's name set",
      status: HOLDS_IN_PRODUCTION.has(key) ? "fixed" : { open: `with production's flags the card keeps the typed "${typed}"` },
      fixFlags: NAME_SET,
      ...(emptied ? { fixStatus: { open: emptied } } : {}),
      async run(t) {
        t.directory([...STAFF, shape.row]);
        t.as("salon_director", KEARNEY);
        const thread = t.thread();
        const reply = await thread.say(`create a ca form for ${typed}, they were late opening the salon on 11/2`);
        const card = thread.proposal?.employeeName ?? null;
        const offered = [name, preferred].some((n) => n !== null && reply.content.includes(`**${n}**`));
        expect(card === name || (preferred !== null && card === preferred) || offered, `${name} is neither on the card (${JSON.stringify(card)}) nor offered:\n${reply.content}`).toBe(true);
      },
    });
  }
}

export const NOV6_ROSTER_SHAPES_CASES: ReplayCase[] = cases;
