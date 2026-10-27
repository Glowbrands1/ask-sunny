import { animalAnywhereEnabled, policySpecificTopicsEnabled } from "@/lib/config/chat-quality-flags";

import {
  findManualSection,
  manualSectionHeadings,
  offenseKeyForManualHeading,
  type ManualChunk,
  type ManualSection,
} from "./official-policy-manual";

/**
 * ============================================================================
 * THE SPECIFIC INCIDENT CITES ITS OWN SECTION, CHOSEN BY THE CODE
 * (POLICY_SPECIFIC_TOPICS_ENABLED)
 * ============================================================================
 *
 * A live test, 26 Oct 2026: "create a ca for <name> at <location>. <incident>"
 * saved the Standards of Conduct, page 12, for almost every incident, whatever
 * it was. The manual has a section for most of them, and for the rest the
 * Standards of Conduct lists the infraction on page 13, not page 12.
 *
 *   no wet floor sign                    Safety in the Workplace
 *   a 1 hour break                       Meal and Rest Policy
 *   an instagram post about a guest      Social Media Policy
 *                                        (+ Using Social Media at Work)
 *   sexual comments to a coworker        Sexual and Other Forms of Harassment
 *   brought her puppy in                 Animals in the Workplace (+ Visitors)
 *   took product without paying          Standards of Conduct p.13 (Theft)
 *                                        (+ Handling Theft)
 *   drawer short                         Standards of Conduct p.13 (Register / Bank shortages)
 *   refused / walked off                 Standards of Conduct p.13 (Insubordination)
 *   talking bad about coworkers          Standards of Conduct p.13 (disrespect)
 *
 * THE TABLE BELOW IS WORDS, NOT PAGES. Each rule says which of the manager's
 * words mean which section; the heading is found on the pinned manual's own
 * rows (`findManualSection`) and the page is the one that manual prints. A
 * Standards of Conduct infraction is found by the manual's own line for it, on
 * the chunk that carries the line, and cited with that chunk's PRINTED page.
 * Nothing here remembers a page, so a re-issued manual is followed without an
 * edit, and a manual that lacks the section or the line cites nothing new —
 * the section the reading gave before stands.
 *
 * WHAT IT NEVER TOUCHES. Attendance (no call no show, late, left early, a
 * missed meeting), a late opening, dress code, cell phone, closing duties,
 * missed Woven items and a guest treated rudely are decided before this runs,
 * and none of their words is in the table. A harassment reading needs real
 * harassment words: gossip and negative talk are the Standards of Conduct, on
 * page 13, and never Harassment. Pure, and off by default: with the flag off
 * every function here answers "nothing".
 */

/** The Standards of Conduct is the box ticked for these. */
const CONDUCT_HEADING = "Standards of Conduct";
const CONDUCT_BOX = "standards_of_conduct";

type Cite =
  | { readonly kind: "heading"; readonly heading: string }
  | { readonly kind: "conduct_line"; readonly anchor: RegExp };

interface TopicRule {
  readonly id: string;
  /** What the manager's sentence says, lowercase, typos included. Any one is enough. */
  readonly words: readonly RegExp[];
  /** A sentence these words are in is not this incident, unless `unless` is in it too. */
  readonly not?: RegExp;
  readonly unless?: RegExp;
  readonly cite: Cite;
  /** The words ARE the incident when negated ("no wet floor sign"): not read as a denial. */
  readonly negationIsTheIncident?: boolean;
  /** Further sections the same incident is cited under, in order. */
  readonly also?: readonly { readonly heading: string; readonly when?: RegExp }[];
}

/* ------------------------------------------------------------ the words -- */

const ANIMAL = String.raw`(?:pupp(?:y|ies|ie)|pupy|pups?|dogs?|doggy|doggie|doggies|pets?|cats?|kittens?|kitty|animals?|bunny|bunnies|rabbits?|ferrets?|birds?|snakes?|lizards?)`;
const ANIMAL_AT_WORK = new RegExp(
  String.raw`\b(?:brought|bring(?:ing|s)?|brang|had|has|having|allow(?:ed|ing)?|let|letting|kept|keeping|walked in with|came in with|come in with|coming in with|showed up with)\s+(?:\S+\s+){0,3}?${ANIMAL}\b|\b${ANIMAL}\s+(?:\S+\s+){0,3}?(?:in|inside|at)\s+(?:\S+\s+){0,2}?(?:the\s+)?(?:salon|store|location|shop|lobby|building|work)\b`,
);

/*
 * ANIMAL_ANYWHERE_ENABLED (QA SX5 / the sibling app's LS-B11, Pau 27 Oct 2026: "came
 * into the salon to show her team her new puppy"): the animal came after the store and
 * neither shape above matched, so the form cited Standards of Conduct. With
 * the flag on, an animal word anywhere in a sentence that also says where
 * work happens (store, salon, location, shift, team, coworkers, clients …)
 * is the animals incident. The exclusions above (service animal, hot dog,
 * guinea pig) still hold. Off, as before.
 */
const ANIMAL_ALONE = new RegExp(String.raw`\b${ANIMAL}\b`);
const AT_WORK =
  /\b(?:store|salon|location|shop|lobby|building|work|shift|team|coworkers?|co-workers?|clients?|customers?|guests?|counter|front desk|back room|break ?room)\b/;

const SOCIAL_SITE = String.raw`(?:insta(?:gram|gam|grm|gran)?|ig|tik ?tok|tiktoc|facebook|face ?book|fb|snap ?chat|snap|twitter|reddit|youtube|social media|socal media|social midia)`;
const SOCIAL_POST = String.raw`(?:post(?:ed|ing|s)?|stor(?:y|ies)|vid(?:eo)?s?|reels?|pic(?:ture)?s?|photos?|tagged|shared|filmed|filming|recorded|live ?stream\w*|went live|wrote|comment(?:ed|s)? on)`;

const SEXUAL_WORDS = new RegExp(
  [
    String.raw`\bsexual(?:ly)?\s+(?:\S+\s+){0,2}?(?:comments?|remarks?|jokes?|advances?|innuendos?|harass\w*|language|texts?|messages?|pictures?|photos?|touch\w*|content|talk|banter|behavior|behaviour|conduct|inappropriate\w*)`,
    String.raw`\bharass(?:ed|es|ing|ment)?\b`,
    String.raw`\bsexually\s+(?:harass|assault|inappropriate|explicit|suggestive)\w*`,
    String.raw`\b(?:groped|groping|grabbed\s+(?:her|his|their)\s+(?:butt|ass|breast|chest))\b`,
    String.raw`\b(?:hit(?:ting)?|hits)\s+on\s+(?:\S+\s+){0,2}?(?:coworker|co-worker|employee|girl|guy|her|him|them|staff|team)\b`,
    String.raw`\b(?:unwanted|inappropriate)\s+touch\w*`,
    String.raw`\b(?:cat ?call\w*|creep(?:y|ing)\s+(?:comments?|remarks?))\b`,
    String.raw`\bsexts?\b|\bsexting\b`,
  ].join("|"),
);

/**
 * THE TABLE, IN PRECEDENCE ORDER. An account that says more than one thing is
 * read as the first rule it matches: harassment before anything it might also
 * be, a pet before a visitor, theft before a shortage.
 */
const TOPICS: readonly TopicRule[] = [
  {
    id: "harassment",
    words: [SEXUAL_WORDS],
    cite: { kind: "heading", heading: "Sexual and Other Forms of Harassment" },
  },
  {
    id: "animals",
    words: [ANIMAL_AT_WORK],
    not: /\b(?:service animal|hot ?dogs?|guinea pig)\b/,
    cite: { kind: "heading", heading: "Animals in the Workplace" },
    also: [{ heading: "Visitors in the Workplace" }],
  },
  {
    id: "theft",
    words: [
      /\b(?:stole|stolen|steal(?:s|ing)?|theft|thief|shoplift\w*|pilfer\w*)\b/,
      /\b(?:took|take|taking|takes|grabbed|walked out with|left with|went home with|brought home|taken)\s+(?:\S+\s+){0,5}?(?:without\s+(?:paying|pay|ringing|a\s+purchase|permission|buying|purchasing|checking out)|for\s+free|home\s+without)\b/,
      /\b(?:did ?n[o']?t|didn't|never|not|failed to|forgot to)\s+(?:\S+\s+)?(?:pay|paid|ring(?:ing)?|purchase|buy|bought)\s+(?:\S+\s+){0,3}?(?:for\s+)?(?:the\s+|a\s+|any\s+|her\s+|his\s+|their\s+)?(?:products?|lotions?|items?|merch\w*|bottles?|goods|stuff)\b/,
      /\b(?:unauthorized|inappropriate)\s+(?:removal|possession)\b/,
      /\bwithout\s+paying\s+for\b/,
    ],
    cite: { kind: "conduct_line", anchor: /Theft,\s+inappropriate\s+removal/i },
    also: [{ heading: "Handling Theft" }],
  },
  {
    id: "cash",
    words: [
      /\b(?:cash|money|drawer|till|register|bank|deposits?)\s+(?:\S+\s+){0,3}?(?:short(?:age|ages)?|over\s*\/?\s*short|missing|off|discrepanc\w*|did ?n[o']?t\s+balance|not\s+balanc\w*|out\s+of\s+balance)\b/,
      /\b(?:short(?:age|ages)?|shorts?)\s+(?:\S+\s+){0,2}?(?:in|on|from)\s+(?:\S+\s+){0,2}?(?:the\s+)?(?:drawer|till|register|bank|deposit|cash)\b/,
      /\bcash\s*[- ]?handl\w*|\bhandl\w*\s+(?:\S+\s+){0,2}?cash\b|\bmishandl\w*\s+(?:\S+\s+){0,2}?(?:cash|money)\b/,
      /\b(?:drawer|till|register)\s+(?:was\s+|is\s+|came\s+up\s+|ran\s+)?(?:\S+\s+)?short\b|\bshort\s+(?:on\s+|in\s+)?(?:the\s+)?(?:drawer|till|register|cash)\b/,
    ],
    cite: { kind: "conduct_line", anchor: /Register\s*\/\s*Bank\s+shortages/i },
  },
  {
    id: "social_media",
    words: [
      new RegExp(String.raw`\b${SOCIAL_SITE}\b[^.;!?\n]{0,60}?\b${SOCIAL_POST}\b`),
      new RegExp(String.raw`\b${SOCIAL_POST}\b[^.;!?\n]{0,60}?\b(?:on|to|in|onto|via|through)\s+(?:her\s+|his\s+|their\s+|the\s+|a\s+|my\s+|own\s+|personal\s+)*(?:\S+\s+)?${SOCIAL_SITE}\b`),
      new RegExp(String.raw`\b${SOCIAL_SITE}\s+(?:post|story|stories|video|reel|pic|photo)s?\b`),
      /\bposted\s+(?:\S+\s+){0,6}?(?:online|publicly)\b/,
    ],
    not: /\b(?:scroll\w*|browsing|looking\s+at|watching)\b/,
    cite: { kind: "heading", heading: "Social Media Policy" },
    also: [
      {
        heading: "Using Social Media at Work",
        when: /\b(?:at work|on the clock|during (?:her |his |their |a |the |my )?(?:shift|work|hours|work ?day)|while (?:working|on (?:the )?(?:clock|shift))|on shift|from work|in the (?:salon|store|lobby))\b/,
      },
    ],
  },
  {
    id: "safety",
    words: [
      /\b(?:wet|wett?)\s*(?:flr|flo+r|fl\.?|floors?)\b/,
      /\b(?:slippery|slip(?:ped|ping)?\s+hazard|slip\s+and\s+fall|caution\s+signs?|hazard\s+signs?)\b/,
      /\b(?:mopp?ed|mopping|spill\w*|cleaned\s+up)\b[^.;!?\n]{0,40}?\b(?:no|without|did ?n[o']?t\s+(?:put|set|place)\s+(?:out\s+)?(?:a\s+)?)\s*(?:wet\s+)?(?:floor\s+)?sign\b/,
    ],
    cite: { kind: "heading", heading: "Safety in the Workplace" },
    negationIsTheIncident: true,
    also: [{ heading: "Wet Floor Sign", when: /\bwet\s*(?:flr|flo+r|fl\.?|floors?)\s*signs?\b|\bwet\s+signs?\b|\bcaution\s+signs?\b/ }],
  },
  {
    id: "meal_rest",
    words: [
      /\b(?:\d+(?:\.\d+)?|an?|one|two|three|half(?:\s+an?)?)[\s-]*(?:hours?|hrs?|h|minutes?|mins?)\s+(?:long\s+)?(?:lunch|break|brake|meal)s?\b/,
      /\b(?:extended|extending|stretched|skipp?(?:ed|ing)|missed|miss|no|without|didn'?t\s+take|did\s+not\s+take|over|past|long|longer|extra|unauthorized|unpaid)\s+(?:\S+\s+){0,2}?(?:lunch|breaks?|brakes?|meal\s+(?:breaks?|periods?)|rest\s+(?:breaks?|periods?))\b/,
      /\b(?:lunch|breaks?|brakes?)\s+(?:was|were|ran|went|lasted)\s+(?:\S+\s+){0,2}?(?:long|over|past|too long|an hour|\d+)/,
      /\bmeal\s+(?:and\s+rest|break|period)\b/,
    ],
    not: /\bbreak\s*(?:room|rooms|in)\b|\b(?:late|call(?:ed)?\s*(?:out|off)|no[- ]?call|no[- ]?show)\b|\bwet\s+floor\b/,
    cite: { kind: "heading", heading: "Meal and Rest Policy" },
  },
  {
    id: "insubordination",
    words: [
      /\binsubordinat\w*/,
      /\b(?:refus(?:ed|es|ing|al)|would ?n[o']?t|wouldn't|won't|will not|did ?n[o']?t want to|declined)\s+(?:\S+\s+){0,2}?(?:to\s+)?(?:follow|listen|do|help|go|work|comply|clean|close|open|take|perform|cover|stay|leave|change|come)\b/,
      /\brefus(?:ed|es|ing|al)\b/,
      /\bwalk(?:ed|ing|s)?\s+(?:off|out)\s+(?:\S+\s+){0,2}?(?:job|shift|floor|work|the\s+(?:salon|store|location|shop)|on\b)/,
      /\bwalk(?:ed|ing|s)?\s+off\b|\bquit\s+(?:in the middle|mid[- ]?shift)\b|\bleft\s+(?:in the middle of|during)\s+(?:\S+\s+)?(?:her|his|their|the|a)\s+(?:shift|work)\b/,
      /\b(?:ignored|ignoring|disregard\w*|defied|defying)\s+(?:\S+\s+){0,3}?(?:directions?|instructions?|directives?|manager|sd|asd|dm|supervisor|requests?|orders?)\b|\b(?:talked back|talking back|argu(?:ed|ing)\s+with\s+(?:her|his|the)\s+(?:manager|sd|dm|supervisor))\b/,
    ],
    /* Woven items, acknowledgements and deadlines are the Standards of Conduct on page 12, whatever the verb. */
    not: /\b(?:woven|acknowledg\w*|deadlines?|due date|training|modules?)\b/,
    cite: { kind: "conduct_line", anchor: /Insubordination/i },
  },
  {
    id: "disrespect",
    words: [
      /\b(?:talk(?:ing|ed|s)?|speak(?:ing|s)?|spoke|say(?:ing|s)?|said)\s+(?:\S+\s+){0,2}?(?:bad|badly|negative(?:ly)?|trash|smack|poorly|ugly|mean(?:ly)?|crap|shit)\b/,
      /\b(?:bad[- ]?mouth\w*|trash[- ]?talk\w*|smack[- ]?talk\w*|gossip\w*|backbit\w*|badtalk\w*)\b/,
      /\bnegative\s+(?:talk|comments?|attitude|energy|remarks?|talking|chatter|behavior|behaviour)\b/,
      /\b(?:disrespect\w*|rude|unprofessional|snippy|snapped|yelled|yelling|cursed|cursing|swore|swearing)\s+(?:\S+\s+){0,2}?(?:to|at|toward|towards|with|about|of)\s+(?:\S+\s+){0,2}?(?:her|his|their|the|a|my|our)?\s*(?:manager|managers|sd|asd|dm|supervisor|coworkers?|co-workers?|team\s*members?|teammates?|colleagues?|staff|employees?|coworker's)\b/,
      /\b(?:complain\w*|vent\w*|rant\w*)\s+(?:\S+\s+){0,3}?(?:about|to)\s+(?:\S+\s+){0,2}?(?:her|his|their|the|a)?\s*(?:manager|managers|sd|asd|dm|coworkers?|co-workers?|team|staff|employees?|company)\b/,
    ],
    /* A guest treated rudely is the Standards of Conduct on page 12 (Pau confirmed): not here, unless a coworker is in it too. */
    not: /\b(?:guests?|customers?|clients?|members?)\b/,
    unless: /\b(?:coworkers?|co-workers?|team\s*members?|teammates?|colleagues?|staff|employees?|manager|managers|sd|asd|dm|supervisor)\b/,
    cite: { kind: "conduct_line", anchor: /Behavior that demonstrates disrespect/i },
  },
  {
    /* Rude to a guest is the Standards of Conduct, page 12 (Pau confirmed): the heading, not a listed line. */
    id: "rude_guest",
    words: [
      /\b(?:rude|disrespectful|unprofessional|snippy|snapped|yelled|yelling|cursed|cursing|swore|swearing|argu(?:ed|ing)|attitude|short)\s+(?:\S+\s+){0,2}?(?:to|at|toward|towards|with)\s+(?:\S+\s+){0,2}?(?:guests?|customers?|clients?|members?)\b/,
      /\b(?:guests?|customers?|clients?)\s+(?:complained|complaint)\b/,
    ],
    cite: { kind: "heading", heading: CONDUCT_HEADING },
  },
];

/* ------------------------------------------------------------- reading -- */

function sentencesOf(text: string): string[] {
  const out: string[] = [];
  const normal = (text ?? "").replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"').toLowerCase();
  for (const match of normal.matchAll(/[^.!?\n]+[.!?]*/g)) {
    const sentence = match[0].trim();
    if (sentence === "") continue;
    /* A question names no incident, unless it is a request: "can we write her up for …". */
    if (/\?\s*$/.test(sentence) && !/^(?:hey,?\s+)?(?:can|could|would|will)\s+(?:we|you|i)\s+(?:please\s+)?(?:put|write|do|start|issue|give|create|make|draft|file|document|doc|log|get)\b/.test(sentence)) {
      continue;
    }
    out.push(sentence);
  }
  return out;
}

export interface SpecificTopic {
  readonly id: string;
  /** The manager's words that said it, as written (lowercase). */
  readonly phrase: string;
  readonly cite: Cite;
  readonly also: readonly string[];
}

/**
 * The incident the account describes, or null. Off, never. The first rule of
 * the table that any sentence of the account matches.
 */
/*
 * A DENIAL IS NOT THE INCIDENT: "she did not steal anything", "no sexual
 * comments were made", "the drawer was not short", "she was not rude to the
 * guest" name the act to say it did not happen. A match is read as a denial
 * where a negation stands within three words before it (in the same clause),
 * or a copula + "not" sits inside it ("drawer was not short"). The one rule
 * whose incident IS an absence ("no wet floor sign") is exempt.
 */
const NEGATION_WORD = /^(?:no|not|never|nor|neither|none|nothing|nobody|without|cannot|n't|(?:did|do|does|was|were|is|are|has|had|have|can|would|could)n'?t)$/;
const COPULA_NOT = /\b(?:(?:was|is|were|are)\s+not|wasn'?t|isn'?t|weren'?t|aren'?t)\s+(?!balanc|accurate|right|correct|there|enough|matching)/;

function denied(sentence: string, index: number, matched: string, rule: TopicRule): boolean {
  if (rule.negationIsTheIncident) return false;
  if (COPULA_NOT.test(matched)) return true;
  const clause = sentence.slice(0, index).split(/[,;:]|\b(?:but|and|so|because|then|although|though)\b/).pop() ?? "";
  const before = clause.trim().split(/\s+/).filter(Boolean).slice(-3);
  return before.some((word) => NEGATION_WORD.test(word.replace(/[.!"]/g, "")));
}

function positiveMatch(pattern: RegExp, sentence: string, rule: TopicRule): RegExpExecArray | null {
  const every = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  for (let match = every.exec(sentence); match; match = every.exec(sentence)) {
    if (match[0] === "") {
      every.lastIndex += 1;
      continue;
    }
    if (!denied(sentence, match.index, match[0], rule)) return match;
  }
  return null;
}

export function specificTopic(text: string): SpecificTopic | null {
  if (!policySpecificTopicsEnabled()) return null;
  const sentences = sentencesOf(text);
  for (const rule of TOPICS) {
    for (const sentence of sentences) {
      if (rule.not?.test(sentence) && !rule.unless?.test(sentence)) continue;
      const anywhere = rule.id === "animals" && animalAnywhereEnabled() && AT_WORK.test(sentence) ? [ANIMAL_ALONE] : [];
      for (const pattern of [...rule.words, ...anywhere]) {
        const match = positiveMatch(pattern, sentence, rule);
        if (!match) continue;
        const also = (rule.also ?? []).filter((entry) => entry.when === undefined || sentences.some((s) => entry.when!.test(s))).map((entry) => entry.heading);
        return { id: rule.id, phrase: match[0].trim(), cite: rule.cite, also };
      }
    }
  }
  return null;
}

/** The Standards of Conduct heading's chunk and the next section's, so a line is only taken from inside it. */
function conductRange(chunks: readonly ManualChunk[]): { from: number; to: number } | null {
  const conduct = findManualSection(chunks, [CONDUCT_HEADING]);
  if (!conduct) return null;
  const next = findManualSection(chunks, ["Disciplinary Action"]);
  return { from: conduct.chunkIndex, to: next && next.chunkIndex > conduct.chunkIndex ? next.chunkIndex : Number.POSITIVE_INFINITY };
}

/**
 * The Standards of Conduct as cited for one listed infraction: the manual's own
 * line for it, on the chunk that carries it, with that chunk's PRINTED page.
 * Null where the manual has no such line or the chunk prints no page — the
 * heading's own page then stands.
 */
function conductLineSection(chunks: readonly ManualChunk[], anchor: RegExp): ManualSection | null {
  const heading = findManualSection(chunks, [CONDUCT_HEADING]);
  const range = conductRange(chunks);
  if (!heading || !range) return null;
  const chunk = chunks
    .filter((entry) => entry.chunkIndex >= range.from && entry.chunkIndex < range.to && anchor.test(entry.content))
    .sort((a, b) => a.chunkIndex - b.chunkIndex)[0];
  const printed = chunk?.printedPage;
  if (!chunk || typeof printed !== "number" || !Number.isFinite(printed) || printed <= 0) return null;
  return { heading: heading.heading, page: printed, chunkIndex: chunk.chunkIndex, foundBy: "sheet_heading" };
}

export interface SpecificTopicSection {
  readonly phrase: string;
  readonly section: ManualSection;
  /** The box this section is cited under. */
  readonly offenseKey: string;
  /** Further sections the same incident is cited under, in order. */
  readonly also: readonly ManualSection[];
}

/**
 * The manual section the account's incident is cited under, found on the
 * pinned manual's own rows, or null. Only a heading that exactly one sheet of
 * the manual carries is cited; a manual without it leaves the reading as it was.
 */
export function specificTopicSection(input: {
  readonly text: string;
  readonly chunks: readonly ManualChunk[] | null;
}): SpecificTopicSection | null {
  const chunks = input.chunks;
  if (!chunks || chunks.length === 0) return null;
  const topic = specificTopic(input.text);
  if (!topic) return null;

  const headings = manualSectionHeadings(chunks);
  const carried = (heading: string) => headings.filter((entry) => entry.trim().toLowerCase() === heading.trim().toLowerCase());
  const named = (heading: string): ManualSection | null => (carried(heading).length === 1 ? findManualSection(chunks, [heading]) : null);

  let section: ManualSection | null;
  let offenseKey: string;
  if (topic.cite.kind === "heading") {
    section = named(topic.cite.heading);
    offenseKey = section ? offenseKeyForManualHeading(section.heading) : "";
  } else {
    section = conductLineSection(chunks, topic.cite.anchor);
    offenseKey = CONDUCT_BOX;
  }
  if (!section) return null;

  const also: ManualSection[] = [];
  for (const heading of topic.also) {
    const found = named(heading);
    if (found && found.heading !== section.heading && !also.some((seen) => seen.heading === found.heading)) also.push(found);
  }
  return { phrase: topic.phrase, section, offenseKey, also };
}

/**
 * The Standards of Conduct page for a conduct incident already ticked: where
 * the box is the Standards of Conduct and the account is one the manual lists
 * on its own line (theft, a shortage, insubordination, disrespect), the page is
 * that line's, not the heading's. Every other section passes through as it was.
 */
export function withConductLinePage(
  sections: readonly ManualSection[],
  notes: string | null | undefined,
  chunks: readonly ManualChunk[],
): ManualSection[] {
  if (!policySpecificTopicsEnabled() || sections.length === 0) return [...sections];
  const topic = specificTopic(notes ?? "");
  if (!topic || topic.cite.kind !== "conduct_line") return [...sections];
  const refined = conductLineSection(chunks, topic.cite.anchor);
  if (!refined) return [...sections];
  return sections.map((section) =>
    section.heading.trim().toLowerCase() === CONDUCT_HEADING.toLowerCase() ? refined : section,
  );
}

/**
 * The manual's own wording for the infraction a conduct incident is cited
 * under: the listed bullet, verbatim ("Insubordination -the refusal to follow
 * the directions of the manager."), from the chunk that carries it. A page-13
 * excerpt cut from the top of the chunk would often stop before the bullet it
 * is cited for. Null where the manual has no such bullet.
 */
function conductLineWording(chunks: readonly ManualChunk[], anchor: RegExp): string | null {
  const range = conductRange(chunks);
  if (!range) return null;
  const chunk = chunks
    .filter((entry) => entry.chunkIndex >= range.from && entry.chunkIndex < range.to && anchor.test(entry.content))
    .sort((a, b) => a.chunkIndex - b.chunkIndex)[0];
  if (!chunk) return null;
  const found = anchor.exec(chunk.content);
  if (!found) return null;
  const marker = /(?:^|\n|\.\s)o\s+/g;
  let start = 0;
  for (let m = marker.exec(chunk.content); m && m.index <= found.index; m = marker.exec(chunk.content)) start = m.index + m[0].length;
  const rest = chunk.content.slice(found.index);
  const next = /(?:\n|\.\s)o\s+/.exec(rest.slice(1));
  const end = found.index + (next ? next.index + 1 + (next[0].startsWith(".") ? 1 : 0) : rest.length);
  const line = chunk.content.slice(start, end).replace(/\s+/g, " ").trim();
  return line === "" ? null : line;
}

/**
 * The policies a draft quotes, with the Standards of Conduct page-13 entry
 * quoted as the listed infraction instead of the top of the chunk. Everything
 * else, and flag off, passes through.
 */
export function withConductLineWording<T extends { readonly sectionTitle: string | null; readonly pageLabel: string | null; readonly policyText: string }>(
  policies: readonly T[],
  notes: string | null | undefined,
  chunks: readonly ManualChunk[],
): T[] {
  if (!policySpecificTopicsEnabled()) return [...policies];
  const topic = specificTopic(notes ?? "");
  if (!topic || topic.cite.kind !== "conduct_line") return [...policies];
  const refined = conductLineSection(chunks, topic.cite.anchor);
  const wording = conductLineWording(chunks, topic.cite.anchor);
  if (!refined || !wording) return [...policies];
  return policies.map((policy) =>
    (policy.sectionTitle ?? "").trim().toLowerCase() === CONDUCT_HEADING.toLowerCase() && policy.pageLabel === String(refined.page)
      ? { ...policy, policyText: wording }
      : policy,
  );
}

/* ------------------------------------------------- the coaching "other" -- */

/** Words that say lateness or attendance, the only account "Punctuality" fits. */
const PUNCTUALITY_ACCOUNT =
  /\b(?:late|lateness|tardy|tardiness|punctual\w*|on time|left early|leaving early|clocked in|clocking in|arriv\w*|no[- ]?call|no[- ]?show|absen\w*|call(?:ed)?\s*(?:out|off)|running behind|showed up|show up)\b/i;

/**
 * "Punctuality" is the one write-in the draft prompt shows as its example, and
 * a model that has no better word for an incident copies it: a cell phone
 * coaching came back Other = Punctuality. Where the manager described nothing
 * about lateness, the write-in is dropped (blank, which the manager fills)
 * rather than left as a topic nobody described. Off, the values are untouched.
 */
export function withoutPrimedTopic<T extends Record<string, string | undefined>>(values: T, account: string): T {
  if (!policySpecificTopicsEnabled()) return values;
  const topic = (values.other_topic ?? "").trim();
  if (!/^punctuality\b/i.test(topic) || PUNCTUALITY_ACCOUNT.test(account ?? "")) return values;
  const rest = { ...values };
  delete rest.other_topic;
  return rest;
}

/** The draft prompt's line for an "other" write-in when the flag is on: no example topic to copy. */
export const OTHER_WRITE_IN_INSTRUCTION =
  'When no listed option fits, tick "other" AND name the topic in the matching write-in field, in a few words of the manager\'s own — only what they described.';
