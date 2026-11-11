import { PRODUCTION_SALONS } from "@/data/salons";

/**
 * The words a typo may be read as (`typo-match.ts`). Four kinds, one list:
 *
 *   the readers' own keywords — the words the chat's readers look for, which
 *   the variation report's typo variants showed are the ones a slip breaks
 *   ("coahed", "amont", "notcie", "regiter shoratge", "Manger");
 *   job-title words; salon names; manual policy heading words.
 *
 * Words under five letters are never corrected, so they are not listed; place
 * words under six letters are left out (they sit close to common words).
 */
const READER_WORDS = [
  "already", "amount", "attendance", "attending", "behavior", "behaviour", "coached", "coaching", "conduct",
  "conversation", "corrective", "deduct", "deduction", "demotion", "employee", "fulfilled", "issued",
  "manual", "member", "minutes", "monthly", "notice", "opened", "opening", "payroll", "performance", "policy",
  "previous", "register", "resigned", "resignation", "schedule", "scheduled", "shortage", "should",
  "standards", "tardiness", "absenteeism", "termination", "verbal", "violating", "violation", "warning",
  "worked", "written",
];

const TITLE_WORDS = ["assistant", "consultant", "director", "district", "manager", "regional", "training", "tanning", "salon"];

const HEADING_WORDS = [
  "animals", "harassment", "safety", "social", "theft", "visitors", "workplace",
];

/**
 * Real words a manager may well type that sit one edit from a word above
 * ("warming" / warning, "opener" / opened, "police" / policy). They are never
 * corrected. Short or crowded words ("store": stole, stone, score …; "smart":
 * start) are left off the list above instead. "manger" is NOT kept: in a
 * manager's chat it is the slip for "manager".
 */
export const NEVER_CORRECTED: ReadonlySet<string> = new Set([
  "absentees", "amending", "appending", "ascending", "assistance", "assisting", "attendant", "attendants",
  "attesting", "behaviors", "behavioural", "cached", "coaches", "collective", "conduit", "connective",
  "conservation", "constant", "consultancy", "consulting", "conversion", "correcting", "correction",
  "dedication", "deduce", "defection", "dejection", "depiction", "detection", "devotion", "directory",
  "distract", "employed", "employer", "fulfills", "issuer", "issues", "manage", "managed", "manages",
  "minuets", "minuses", "novice", "opener", "opined", "pervious", "police", "precious", "resister", "safely",
  "salmon", "saloon", "scheduler", "schedules", "start", "terminating", "terminator", "trailing",
  "vibrating", "vibration", "vocation", "volition", "waning", "warding", "warming", "warping", "warring",
  "worded", "worker", "workpiece", "workspace",
]);

function placeWords(): string[] {
  return PRODUCTION_SALONS.flatMap((salon) => salon.name.toLowerCase().split(/[^a-z]+/)).filter((word) => word.length >= 6);
}

let vocabulary: readonly string[] | null = null;

export function typoVocabulary(): readonly string[] {
  vocabulary ??= [...new Set([...READER_WORDS, ...TITLE_WORDS, ...HEADING_WORDS, ...placeWords()])];
  return vocabulary;
}
