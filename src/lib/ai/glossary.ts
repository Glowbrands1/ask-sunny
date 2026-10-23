/**
 * House terms. One line adds a shorthand.
 *
 * `term` is what a manager types. `canonical` is the wording the form
 * detectors and the policy headings already use. `section` and `page` are
 * the manual's own heading when the shorthand names one.
 */

export interface HouseTerm {
  readonly term: string;
  readonly canonical: string;
  readonly section?: string;
  readonly page?: number;
  readonly kind: "form" | "policy";
  readonly templateKey?: string;
}

export const HOUSE_GLOSSARY: readonly HouseTerm[] = [
  { term: "ca", canonical: "corrective action form", kind: "form", templateKey: "dpoa" },
  { term: "c.a.", canonical: "corrective action form", kind: "form", templateKey: "dpoa" },
  { term: "c/a", canonical: "corrective action form", kind: "form", templateKey: "dpoa" },
  { term: "dpoa", canonical: "corrective action form", kind: "form", templateKey: "dpoa" },
  { term: "write up", canonical: "corrective action form", kind: "form", templateKey: "dpoa" },
  { term: "write-up", canonical: "corrective action form", kind: "form", templateKey: "dpoa" },
  { term: "writeup", canonical: "corrective action form", kind: "form", templateKey: "dpoa" },
  { term: "paperwork", canonical: "corrective action form", kind: "form", templateKey: "dpoa" },
  { term: "coaching form", canonical: "coaching form", kind: "form", templateKey: "coaching" },
  { term: "follow-up coaching", canonical: "follow-up coaching", kind: "form", templateKey: "follow-up-coaching" },
  { term: "follow up coaching", canonical: "follow-up coaching", kind: "form", templateKey: "follow-up-coaching" },
  { term: "stc exit", canonical: "stc exit form", kind: "form", templateKey: "stc-exit" },
  { term: "exit form", canonical: "exit form", kind: "form", templateKey: "stc-exit" },
  { term: "exit paperwork", canonical: "exit paperwork", kind: "form", templateKey: "stc-exit" },
  { term: "resignation form", canonical: "resignation form", kind: "form", templateKey: "stc-exit" },
  { term: "policy review", canonical: "policy review", kind: "form", templateKey: "policy-review" },
  { term: "demotion form", canonical: "demotion form", kind: "form", templateKey: "demotion" },
  { term: "position transfer", canonical: "position transfer", kind: "form", templateKey: "position-transfer" },
  { term: "sdit epp", canonical: "sdit epp", kind: "form", templateKey: "sdit-epp" },
  { term: "tsd epp", canonical: "tsd epp", kind: "form", templateKey: "tsd-epp" },
  { term: "late open", canonical: "Late Opening", section: "Late Opening", page: 15, kind: "policy" },
  { term: "late opening", canonical: "Late Opening", section: "Late Opening", page: 15, kind: "policy" },
  { term: "opened late", canonical: "Late Opening", section: "Late Opening", page: 15, kind: "policy" },
  { term: "tardy", canonical: "Attendance", section: "Attendance", page: 14, kind: "policy" },
  { term: "tardiness", canonical: "Attendance", section: "Attendance", page: 14, kind: "policy" },
  { term: "no call no show", canonical: "Attendance", section: "Attendance", page: 14, kind: "policy" },
  { term: "no show", canonical: "Attendance", section: "Attendance", page: 14, kind: "policy" },
  { term: "cell phone", canonical: "Cell Phone/Smart Watch Policy", section: "Cell Phone/Smart Watch Policy", page: 19, kind: "policy" },
  { term: "cellphone", canonical: "Cell Phone/Smart Watch Policy", section: "Cell Phone/Smart Watch Policy", page: 19, kind: "policy" },
  { term: "cellfone", canonical: "Cell Phone/Smart Watch Policy", section: "Cell Phone/Smart Watch Policy", page: 19, kind: "policy" },
  { term: "celphone", canonical: "Cell Phone/Smart Watch Policy", section: "Cell Phone/Smart Watch Policy", page: 19, kind: "policy" },
  { term: "fone", canonical: "Cell Phone/Smart Watch Policy", section: "Cell Phone/Smart Watch Policy", page: 19, kind: "policy" },
  { term: "phone", canonical: "Cell Phone/Smart Watch Policy", section: "Cell Phone/Smart Watch Policy", page: 19, kind: "policy" },
  { term: "cell", canonical: "Cell Phone/Smart Watch Policy", section: "Cell Phone/Smart Watch Policy", page: 19, kind: "policy" },
  { term: "smart watch", canonical: "Cell Phone/Smart Watch Policy", section: "Cell Phone/Smart Watch Policy", page: 19, kind: "policy" },
  { term: "parking lot", canonical: "Employee Parking", section: "Employee Parking", page: 18, kind: "policy" },
  { term: "employee parking", canonical: "Employee Parking", section: "Employee Parking", page: 18, kind: "policy" },
  { term: "smartwatch", canonical: "Cell Phone/Smart Watch Policy", section: "Cell Phone/Smart Watch Policy", page: 19, kind: "policy" },
  { term: "dress code", canonical: "Dress Code for The Company", section: "Dress Code for The Company", page: 15, kind: "policy" },
  { term: "dresscode", canonical: "Dress Code for The Company", section: "Dress Code for The Company", page: 15, kind: "policy" },
  { term: "standards of conduct", canonical: "Standards of Conduct", section: "Standards of Conduct", page: 12, kind: "policy" },
  { term: "visitors at work", canonical: "Visitors in the Workplace", section: "Visitors in the Workplace", page: 30, kind: "policy" },
  { term: "seminar", canonical: "Seminar/Webinar Attendance", section: "Seminar/Webinar Attendance", page: 37, kind: "policy" },
  { term: "webinar", canonical: "Seminar/Webinar Attendance", section: "Seminar/Webinar Attendance", page: 37, kind: "policy" },
];

export interface GlossaryHit {
  readonly term: HouseTerm;
  readonly start: number;
  readonly end: number;
}

const ORDERED = [...HOUSE_GLOSSARY].sort((a, b) => b.term.length - a.term.length);

function patternFor(term: string): RegExp {
  const body = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|[^a-z0-9])(${body})(?=$|[^a-z0-9])`, "gi");
}

/** Longest shorthand wins, so "exit paperwork" is not also read as "paperwork". */
export function matchGlossary(text: string): GlossaryHit[] {
  const taken: { start: number; end: number }[] = [];
  const hits: GlossaryHit[] = [];
  for (const term of ORDERED) {
    for (const match of text.matchAll(patternFor(term.term))) {
      const raw = match[1] ?? "";
      const start = (match.index ?? 0) + match[0].indexOf(raw);
      const end = start + raw.length;
      if (taken.some((span) => start < span.end && end > span.start)) continue;
      if (term.term === "phone" && /^\s+interviews?\b/i.test(text.slice(end))) continue;
      taken.push({ start, end });
      hits.push({ term, start, end });
    }
  }
  return hits;
}

/** The original words, then any canonical term or section title they did not already contain. */
export function expandGlossaryQuery(text: string): string {
  const extras: string[] = [];
  const hay = text.toLowerCase();
  for (const hit of matchGlossary(text)) {
    for (const phrase of [hit.term.canonical, hit.term.section].filter((value): value is string => Boolean(value))) {
      if (!hay.includes(phrase.toLowerCase()) && !extras.some((extra) => extra.toLowerCase() === phrase.toLowerCase())) {
        extras.push(phrase);
      }
    }
  }
  if (extras.length === 0) return text;
  return `${text}\n${extras.join("\n")}`;
}

export function glossaryPrompt(): string {
  return HOUSE_GLOSSARY.map((entry) => {
    const where = entry.section ? ` → ${entry.section}${entry.page ? ` (p.${entry.page})` : ""}` : "";
    return `${entry.term} = ${entry.canonical}${where}`;
  }).join("\n");
}

const QUESTION = /\?|\b(?:what|whats|what's|how|why|when|where|which|does|is there|can you tell|ano)\b/i;

export type GlossaryIntent = "form" | "policy" | "other";

export function glossaryIntent(text: string): GlossaryIntent {
  const hits = matchGlossary(text);
  const form = hits.some((hit) => hit.term.kind === "form");
  const policy = hits.some((hit) => hit.term.kind === "policy");
  const question = QUESTION.test(text);
  if (policy && question) return "policy";
  if (form && !question) return "form";
  if (policy) return "policy";
  return "other";
}
