import { PRODUCTION_SALONS } from "@/data/salons";
import { readDirectoryFacts, readDirectoryRoster, readScopedRoster } from "@/lib/forms/employee-roster";

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
}

/** Ask Sunny (Sun Tan City). */
export const SUNNY_CONFIG: AppConfig = {
  appName: "Sunny",
  brandName: "Sun Tan City",
  locationWord: "salon",
  locationWordPlural: "salons",
  staffSystem: "Woven",
  formKeys: { exit: "stc-exit", corrective: "dpoa", coaching: "coaching", followUpCoaching: "follow-up-coaching" },
  locations: () => PRODUCTION_SALONS,
  // Wrappers, so a test that replaces the roster module's export is still seen at call time.
  roster: {
    readScoped: (...args) => readScopedRoster(...args),
    readDirectory: (...args) => readDirectoryRoster(...args),
    readDirectoryFacts: (...args) => readDirectoryFacts(...args),
  },
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
