/**
 * ============================================================================
 * THE PHRASING TABLE: ONE BEHAVIOUR, MANY WAYS A MANAGER SAYS IT
 * ============================================================================
 *
 * Pau's audit (15 Nov 2026): the loop must do the same thing however the manager phrases a request. A model reads
 * the words and passes structured tool arguments; the code checks those arguments against the saved form, never
 * the manager's wording. So for each behaviour below, every phrasing gets the SAME mocked-model decision (the same
 * structured tool arguments) and must end in the SAME outcome, asserted on saved data and structured tool results,
 * never on an English phrase.
 *
 * The cases are generated from this table into the replay pack (`replay-pack/nov15-agent-loop-phrasing-cases.ts`,
 * which runs the real chat route); `phrasing.test.ts` checks the table itself.
 *
 * Invented people only (the repository is public). A phrasing is how a manager types: lowercase, typos, no
 * punctuation, short, long, and the same words reordered.
 */

export const PHRASING_KINDS = ["lowercase", "typo", "no-punctuation", "short", "long", "reordered"] as const;
export type PhrasingKind = (typeof PHRASING_KINDS)[number];

export interface Phrasing {
  readonly kind: PhrasingKind;
  readonly said: string;
}

export interface Behaviour {
  /** Stable key; part of every generated case id. */
  readonly key: "write-account" | "answer-level" | "answer-payroll" | "fix-name" | "exit-form" | "forms-on-file" | "undo-level" | "nothing-changed";
  readonly what: string;
  readonly phrasings: readonly Phrasing[];
}

/** The person every behaviour is about, and the corrected surname for "fix the name". */
export const TESTY = { id: "e-test-testy", firstName: "Test", lastName: "Testy", corrected: "Testy-Vale" } as const;
/** The incident account on the card (the manager's turn that opens each scenario). */
export const TESTY_ACCOUNT = "Test Testy was late to open the salon on 11/10.";

const p = (kind: PhrasingKind, said: string): Phrasing => ({ kind, said });

export const BEHAVIOURS: readonly Behaviour[] = [
  {
    key: "write-account",
    what: "a draft is open with an empty Observation; the manager asks for the account to be written onto it",
    phrasings: [
      p("lowercase", "write the observation"),
      p("typo", "wrtie the obsrvation"),
      p("no-punctuation", "ok put that on the form"),
      p("short", "write it up"),
      p("long", "could you please write the observation on the form from what I told you about her being late to open on 11/10 so it is all in there"),
      p("reordered", "on the form, put what I told you"),
    ],
  },
  {
    key: "answer-level",
    what: "a card waits; the manager answers the warning level",
    phrasings: [
      p("lowercase", "make it a written"),
      p("typo", "make it a writen"),
      p("no-punctuation", "written warning please"),
      p("short", "written"),
      p("long", "after thinking about it with my district manager I would say this one should go on the form as a written warning"),
      p("reordered", "a written, make it"),
    ],
  },
  {
    key: "answer-payroll",
    what: "a card waits; the manager answers payroll deduct, yes, twenty dollars",
    phrasings: [
      p("lowercase", "yes payroll, $20"),
      p("typo", "yes payrol deduct $20"),
      p("no-punctuation", "yes payroll deduct 20 dollars"),
      p("short", "yes $20"),
      p("long", "we do want to take the cost out of her payroll, it is twenty dollars, so payroll deduct yes"),
      p("reordered", "$20 payroll deduct, yes"),
    ],
  },
  {
    key: "fix-name",
    what: "a draft is open; the manager corrects the surname; only the employee name changes",
    phrasings: [
      p("lowercase", "fix her last name, it is Testy-Vale"),
      p("typo", "fix her lastname its Testy-Vale"),
      p("no-punctuation", "her last name is spelled Testy-Vale"),
      p("short", "last name Testy-Vale"),
      p("long", "sorry, I spelled her name wrong at the start; her surname is really Testy-Vale, with the hyphen, please correct it"),
      p("reordered", "Testy-Vale is her last name, fix it"),
    ],
  },
  {
    key: "exit-form",
    what: "the manager asks for the Employee Exit Form for someone who resigned",
    phrasings: [
      p("lowercase", "exit form for test testy, she gave notice, last day 11/20"),
      p("typo", "exti form for test testy, she gave notice, last day 11/20"),
      p("no-punctuation", "test testy resigned i need the exit form last day is 11/20"),
      p("short", "exit form test testy resigned"),
      p("long", "I need to get the paperwork started for Test Testy, she told me today she is resigning, her last day is 11/20, can you make the exit form"),
      p("reordered", "she gave notice, last day 11/20, exit form for Test Testy"),
    ],
  },
  {
    key: "forms-on-file",
    what: "the manager asks what forms are on file for a person",
    phrasings: [
      p("lowercase", "what forms does test testy have on file"),
      p("typo", "what forms does test testy have on fiel"),
      p("no-punctuation", "show me test testy's forms on file"),
      p("short", "test testy forms on file"),
      p("long", "before I talk to her tomorrow I want to see everything that is on file for Test Testy, any coaching or corrective action forms"),
      p("reordered", "on file for Test Testy, what forms"),
    ],
  },
  {
    key: "undo-level",
    what: "a draft is open as a written; the manager takes it back to a verbal",
    phrasings: [
      p("lowercase", "undo that, make it a verbal"),
      p("typo", "undo that, make it a verbl"),
      p("no-punctuation", "undo that its a verbal"),
      p("short", "verbal instead"),
      p("long", "actually I talked to HR and the written was a mistake on my part, please put the warning back to a verbal on the draft"),
      p("reordered", "a verbal, not a written, undo that"),
    ],
  },
  {
    key: "nothing-changed",
    what: "a draft is open as a written; the manager asks for the level it already has; nothing may change",
    phrasings: [
      p("lowercase", "make it a written"),
      p("typo", "make it a writen"),
      p("no-punctuation", "its a written"),
      p("short", "written"),
      p("long", "just to be sure the draft should say written warning for the level, can you make sure it is"),
      p("reordered", "a written, make sure it is"),
    ],
  },
];
