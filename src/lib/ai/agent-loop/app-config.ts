import { SUNNY_METRICS, SUNNY_POLICY_GUARDS, sunnyLoopContent } from "@/config/company/agent-loop";
import { PRODUCTION_SALONS } from "@/data/salons";
import { ACTIVE_BRAND } from "@/lib/brand";
import { readDirectoryFacts, readDirectoryRoster, readScopedRoster } from "@/lib/forms/employee-roster";
import { JOB_TITLES } from "@/lib/forms/proposal";

/**
 * ============================================================================
 * THE AGENT LOOP'S APP CONFIG: every word and key that belongs to one app
 * ============================================================================
 *
 * The loop (tools, run, rules book, prompt) is the same code in Ask Sunny and its sibling app; what differs is
 * this file. The app's name, its word for a place ("salon"), the staff system the roster comes from ("Woven"),
 * the keys of the four forms the loop treats specially, the list of places and the roster reader live here and
 * nowhere else. Porting the loop is this file with the other app's values.
 *
 * Mechanism, not content: the rules book and the tool texts take their words from `appConfig()` as template
 * strings, so a second config changes every one of them (`app-config.test.ts` proves it with a fake config and
 * proves Sunny's own text is byte-identical to before). Field and tool-argument names (`salon`, `which_salon`,
 * `salon_from_woven`) are the contract between the tools and the model, not wording, and stay as they are.
 */

/** The place and staff words a company's content is written with (the config's own). */
export interface LoopWords {
  readonly place: string;
  readonly places: string;
  readonly staff: string;
}

/**
 * ONE COMPANY'S CONTENT IN THE RULES BOOK (Phase 1 of the loop port, QA 21 Nov 2026). The rules book is mechanism; these
 * are the parts that belong to one company: rulings on its manual's headings, its metrics and reports, its time zone,
 * who approves a termination, the page forms are listed on, and the example phrases the rules teach with. Each app
 * keeps its own in `src/config/company/agent-loop.ts`; a rule another app has no use for is null and left out.
 */
export interface AgentLoopContent {
  /** Company words that are never people, said in the "a name only if" rule. */
  readonly notPeopleExamples: string;
  /** What "Other — <topic>" is for, besides an incident no section covers. */
  readonly otherTopics: string;
  /** The reports read_stats reads ("Daily Stats, Sales Totals and Comp"); null when the app has no read_stats. */
  readonly statsReports: string | null;
  /** Who approves a termination before it is finalized ("DM/HR approval"). */
  readonly terminationApproval: string;
  /** The business time zone as the rules say it: in full, short, and its abbreviation on times. */
  readonly timeZone: { readonly label: string; readonly short: string; readonly abbrev: string };
  /** Who-the-form-is-for rules about this company's words (shorthand that is never a person). */
  readonly whoRules: readonly string[];
  /** Which manual heading fits which incident, before the general policy rules. */
  readonly policyRulings: readonly string[];
  /** Incidents that have their own section, after the general policy rules. */
  readonly sectionRulings: readonly string[];
  /** What a Corrective Action citing attendance must carry. */
  readonly attendanceRules: readonly string[];
  /** Card reply lines for this company's own card facts. */
  readonly underPerformanceReplies: readonly string[];
  /** How the account keeps this company's metrics; null when it has none to teach. */
  readonly metricsRule: string | null;
  /** How a volume figure before the metrics reads; null when it has none. */
  readonly volumeRule: string | null;
  /** How a stats focus answer cites its guide; null when the app has no stats guide. */
  readonly statsGuideRule: string | null;
  /** Example phrases in the rules, in this company's words. */
  readonly examples: {
    readonly addedTopic: string;
    readonly addedTopicQuestion: string;
    readonly namedPolicy: string;
    readonly misspelledPolicy: string;
    readonly formAbout: string;
    readonly spellingFixes: string;
    readonly becausePlace: string;
    readonly ruleInOtherSection: string;
    readonly approvedTermination: string;
    readonly rewordNoLink: string;
    readonly policyLine: string;
    readonly position: string;
    readonly howTo: string;
    readonly businessDocs: string;
  };
}

/**
 * WHICH MANUAL HEADING THE CODE'S POLICY GUARDS CHECK, BY ROLE (Phase 1 of the loop port, QA 21 Nov 2026). The guards
 * in `tools.ts` and `policy-fit.ts` are mechanism; the headings they name are one company's manual. A role the company's
 * manual has no heading for is null, and its guard is off.
 */
export interface PolicyGuards {
  readonly headings: {
    /** Lateness and absence ("Attendance"). */
    readonly attendance: string | null;
    /** The location opening late ("Late Opening"): "late to open" is this, never attendance. */
    readonly lateOpening: string | null;
    /** Conduct, where sales or performance below target goes ("Standards of Conduct"). */
    readonly conduct: string | null;
  };
  /**
   * An "Other — <label>" topic cited only when the manager says it (Sunny: Must See Behaviors, Pau's ruling of
   * 16 Nov 2026), with how a cited policy, the manager's words and a looser naming of it are recognised. Null: none.
   */
  readonly saidOnlyOther: {
    readonly label: string;
    /** How the rule says the manager names it ("MSB or must see behaviors"). */
    readonly saidAs: string;
    readonly cited: RegExp;
    readonly said: RegExp;
    readonly named: RegExp;
  } | null;
}

export interface AppConfig {
  /** What the assistant is called in its own prompt and help ("Sunny"). */
  readonly appName: string;
  /** The company's brand, said in the rules book's "name only this company's brand" rule. */
  readonly brandName: string;
  /** The word for a place a form is filed at, and its plural ("salon", "salons"). */
  readonly locationWord: string;
  readonly locationWordPlural: string;
  /** The staff system the roster comes from ("Woven"). */
  readonly staffSystem: string;
  /** The form templates the loop treats specially. */
  readonly formKeys: {
    readonly exit: string;
    readonly corrective: string;
    readonly coaching: string;
    readonly followUpCoaching: string;
  };
  /** Every place in the app (a global login may pick any of them). */
  readonly locations: () => typeof PRODUCTION_SALONS;
  /** The roster readers: the signed-in manager's scoped roster, the whole directory, and its per-person facts. */
  readonly roster: {
    readonly readScoped: typeof readScopedRoster;
    readonly readDirectory: typeof readDirectoryRoster;
    readonly readDirectoryFacts: typeof readDirectoryFacts;
  };
  /**
   * The company's job titles, as a manager may type them before or after a name ("TC <name>", "<name> TC",
   * "Tanning Consultant, <name>"): taken off a typed name before it is looked up (QA, 16 Nov 2026, the 266 re-run's c220).
   */
  readonly jobTitles: readonly RegExp[];
  /**
   * A roster job title that leads others (manager, director, lead, supervisor): someone with it who asks or tells the
   * card's person something speaks for the salon, so a pronoun in what they asked is the card person's (Pau's ruling,
   * QA 17 Nov 2026). Read from the roster's job title, never from the manager's words.
   */
  readonly leadershipTitle: RegExp;
  /** This company's content in the rules book, written with the config's own place and staff words. */
  readonly content: (words: LoopWords) => AgentLoopContent;
  /** The manual headings the policy guards check, by role. */
  readonly policyGuards: PolicyGuards;
  /** The page that lists the forms ("Form Monitoring"), in tool messages and the rules book. */
  readonly formsPageName: string;
  /**
   * This company's sales metrics as a manager writes them (Sunny: PPTA, Club Close % …; global, as `matchAll` reads
   * it), kept word for word in the account and never read as people, and the short ones a manager may spell out
   * ("MSB" said as "must see behaviors").
   */
  readonly metrics: {
    readonly account: RegExp;
    readonly spelledOut: readonly { readonly short: string; readonly long: RegExp }[];
  };
}

/** Ask Sunny: the brand's names and place words, plus the staff system and form keys of this app. */
export const SUNNY_CONFIG: AppConfig = {
  // From the brand, as the loop followed it before the config existed (main: ACTIVE_BRAND in prompt.ts and rules-book.ts).
  appName: ACTIVE_BRAND.assistantName,
  brandName: ACTIVE_BRAND.brandName,
  locationWord: ACTIVE_BRAND.vocabulary.salonNoun,
  locationWordPlural: ACTIVE_BRAND.vocabulary.salonNounPlural,
  staffSystem: "Woven",
  formKeys: { exit: "stc-exit", corrective: "dpoa", coaching: "coaching", followUpCoaching: "follow-up-coaching" },
  locations: () => PRODUCTION_SALONS,
  // Wrappers, so a test that replaces the roster module's export is still seen at call time.
  roster: {
    readScoped: (...args) => readScopedRoster(...args),
    readDirectory: (...args) => readDirectoryRoster(...args),
    readDirectoryFacts: (...args) => readDirectoryFacts(...args),
  },
  jobTitles: JOB_TITLES.map((entry) => entry.pattern),
  leadershipTitle: /\b(?:directors?|managers?|leads?|supervisors?)\b/i,
  content: sunnyLoopContent,
  policyGuards: SUNNY_POLICY_GUARDS,
  formsPageName: "Form Monitoring",
  metrics: SUNNY_METRICS,
};

let active: AppConfig = SUNNY_CONFIG;

/** The config the loop runs with. */
export function appConfig(): AppConfig {
  return active;
}

/** Tests only: run the loop with another app's words. Pass nothing to go back to Sunny's. */
export function setAppConfigForTests(config?: AppConfig): void {
  active = config ?? SUNNY_CONFIG;
}

/** "salon" -> "Salon". */
export function capitalized(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
