import type { Seed } from "./seeds";

/**
 * The automatic rewrites of a seed. Each is a function of the seed's turns
 * alone, deterministic, so a run is repeatable and two runs compare.
 */
export interface Variant {
  readonly kind: string;
  readonly label: string;
  readonly turns: readonly string[];
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function ordinal(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
}

function sentenceCase(turn: string, seed: Seed): string {
  let out = turn.replace(/^\s*([a-z])/, (letter) => letter.toUpperCase()).replace(/([.!?]\s+)([a-z])/g, (_m, gap, letter) => `${gap}${letter.toUpperCase()}`);
  out = out.replace(/\bi\b/g, "I");
  if (seed.name) {
    const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
    out = out.replace(new RegExp(`\\b${seed.name.first}\\b`, "gi"), cap(seed.name.first)).replace(new RegExp(`\\b${seed.name.last}\\b`, "gi"), cap(seed.name.last));
  }
  return out;
}

/** Words never touched by a typo: names, dates, amounts, and the words that name a form. */
function protectedWord(word: string, seed: Seed): boolean {
  const plain = word.toLowerCase().replace(/[^a-z]/g, "");
  if (/\d|\$/.test(word) || plain.length < 5) return true;
  if (seed.name && (plain === seed.name.first || plain === seed.name.last)) return true;
  return /^(?:verbal|written|coaching|corrective|action|payroll|deduct\w*|create|kearney|manhattan|salon|store|exit|form)$/.test(plain);
}

/** One letter dropped (or two neighbours swapped) in the `count` first unprotected long words. */
function typo(turn: string, seed: Seed, count: number, swap: boolean): string {
  let done = 0;
  return turn.replace(/\S+/g, (word) => {
    if (done >= count || protectedWord(word, seed)) return word;
    done += 1;
    const at = Math.floor(word.replace(/[^a-z]/gi, "").length / 2);
    return swap ? word.slice(0, at) + word.charAt(at + 1) + word.charAt(at) + word.slice(at + 2) : word.slice(0, at) + word.slice(at + 1);
  });
}

function dateForms(iso: string): { label: string; text: string }[] {
  const [, month, day] = iso.split("-").map(Number) as [number, number, number];
  const yy = iso.slice(2, 4);
  return [
    { label: "M/D", text: `${month}/${day}` },
    { label: "M-D", text: `${month}-${day}` },
    { label: "M-D-YY", text: `${month}-${day}-${yy}` },
    { label: "M.D", text: `${month}.${day}` },
    { label: "mon D", text: `${MONTHS[month - 1]} ${day}` },
    { label: "month Dth", text: `${MONTH_NAMES[month - 1]} ${ordinal(day)}` },
    { label: "the Dth", text: `the ${ordinal(day)}` },
  ];
}

export function variantsOf(seed: Seed): Variant[] {
  const out: Variant[] = [{ kind: "original", label: "as written", turns: seed.turns }];
  const all = (label: string, kind: string, f: (turn: string) => string) => out.push({ kind, label, turns: seed.turns.map(f) });
  all("lowercase", "case", (turn) => turn.toLowerCase());
  all("UPPERCASE", "case", (turn) => turn.toUpperCase());
  all("Sentence case", "case", (turn) => sentenceCase(turn, seed));
  all("no punctuation", "punctuation", (turn) => turn.replace(/(?<!\d)[.,!?;:](?!\d)/g, ""));
  all("extra spaces", "spacing", (turn) => turn.replace(/ /g, "  ").replace(/^/, " "));
  all("one dropped letter", "typo", (turn) => typo(turn, seed, 1, false));
  all("two swapped letters", "typo", (turn) => typo(turn, seed, 2, true));
  for (const date of seed.dates ?? []) {
    for (const form of dateForms(date.iso)) {
      if (form.text === date.text) continue;
      out.push({ kind: "date", label: `date ${form.label}`, turns: seed.turns.map((turn) => turn.split(date.text).join(form.text)) });
    }
  }
  if (seed.name) {
    const full = new RegExp(`\\b${seed.name.first}\\s+${seed.name.last}\\b`, "gi");
    const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
    out.push({ kind: "name", label: "first name only", turns: seed.turns.map((turn) => turn.replace(full, seed.name!.first)) });
    out.push({ kind: "name", label: "Last, First", turns: seed.turns.map((turn) => turn.replace(full, `${cap(seed.name!.last)}, ${cap(seed.name!.first)}`)) });
    out.push({ kind: "name", label: "Capitalized name", turns: seed.turns.map((turn) => turn.replace(full, `${cap(seed.name!.first)} ${cap(seed.name!.last)}`)) });
  }
  return out;
}
