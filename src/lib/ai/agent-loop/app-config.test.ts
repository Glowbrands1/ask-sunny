import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { appConfig, setAppConfigForTests, SUNNY_CONFIG, type AppConfig } from "./app-config";
import { citesMustSee, namesMustSee, saysMustSee } from "./policy-fit";
import { agentLoopRules, agentLoopSystem } from "./prompt";
import { agentLoopTools } from "./run";
import { rulesBookText } from "./rules-book";

/**
 * PR 5 (app config): the loop's words belong to one file. Sunny's own text must stay byte-for-byte what it was
 * before the config existed (the fixtures were written from the code at main 8f7039c), and a second app's config
 * must change every word that names the app, its place word, its staff system and its form keys.
 *
 * The fixtures were updated on purpose on 15 Nov 2026 for one line: batch K (#1021, merged alongside this config)
 * added the rule 'Say a form or card is "ready" only when propose_form's card.status is "ready" …' to the prompt and
 * the rules book. That line names no app, place, staff system or form key, so it reads the same under every config;
 * nothing else in either text changed.
 *
 * Updated on purpose on 16 Nov 2026 (fix batch item 4): the two "Did you mean" lines in "Who the form is for" became one
 * consistent instruction (a yes or the full name typed back is a yes; confirmed_by_manager). Both lines name no app,
 * place, staff system or form key; nothing else in either text changed.
 *
 * Re-taken on purpose on 16 Nov 2026 (fix batch item 1, an exit card nobody asked for): the Which form exit line now
 * asks for exit_evidence's kind, and one line was added for a resignation told with no ask. Both read the same under
 * every config; nothing else changed.
 *
 * Re-taken on purpose on 20 Nov 2026 (f082, QA's live test): the Attendance line now names left_early (left before the
 * shift ended: "left early", "left before close", "walked out mid-shift") apart from lateness. It reads the same under
 * every config; nothing else changed.
 *
 * Re-taken on purpose on 20 Nov 2026 (board f066, the form deletion record): the tool list gained read_form_deletions
 * and the Business data rules one line for it (administrators only). Neither names the app, place, staff system or form
 * key; nothing else changed.
 *
 * Re-taken on purpose on 23 Nov 2026 (Pau, AI Training -> Assignments): the tool list gained read_ai_assignments and
 * the Business data rules one line for it (only the tracker's named people). Neither names the app, place, staff
 * system or form key; nothing else changed.
 *
 * Re-taken on purpose on 20 Nov 2026 (f048b, QA's live 23a): one Card replies line was added for propose_form's
 * follow_up_on_create (say the follow-up date Create sets; never deny a follow-up the form will have). It reads the same
 * under every config; nothing else changed.
 *
 * Re-taken on purpose on 22 Nov 2026 (the 266-chat run's 039/241, QA's step 3): the Card replies line for the account
 * now reads its label from card.account_label, the form's own (Details of Coaching on a coaching form), never
 * "Observation of Offense" on every incident card. It reads the same under every config; nothing else changed.
 *
 * Re-taken on purpose on 22 Nov 2026 (port from Ask Bubbles 1b34db2, A11): one Forms on file line was added after
 * which_form_question: an answer that gives changes is not a pick; open_form and edit_form need choice_evidence; ask
 * again. It reads the same under every config; nothing else changed.
 *
 * Re-taken on purpose on 22 Nov 2026 (QA's shadow re-run S2): the whole-team Coaching line now says to call coach_team
 * with team_evidence quoting the manager's words for the whole team or group ("my entire sales team"), whatever word
 * they use. It reads the same under every config; nothing else changed.
 *
 * Re-taken on purpose on 21 Nov 2026 (port from the sibling app, its QA's live re-test A5): the what_happened line says
 * the account is a sentence with the person as its subject and names account_no_subject. It reads the same under every
 * config; nothing else changed.
 *
 * Re-taken on purpose on 19 Nov 2026 (the Google Reviews page's L3, L6 and YTD): read_reviews's line in the prompt now
 * names L3, L6, YTD and each month, and the Business data rule says L3 / L6 are full months and come from read_reviews.
 * Both use the config's place word; nothing else changed.
 *
 * Re-taken on purpose on 16 Nov 2026 (fix batch item 7, a bare "yes" set payroll): one Card replies line was added for
 * payroll_answer_unclear. It reads the same under every config; nothing else changed.
 *
 * Re-taken on purpose on 16 Nov 2026 (QA's pre-launch re-test, E r2: a bare "yes" got a reply claiming payroll $20):
 * the six example amounts became "$<amount>" (no figure the model can copy), and the payroll_answer_unclear line asks
 * which the answer is for and the amount. They read the same under every config; nothing else changed.
 *
 * Re-taken on purpose on 16 Nov 2026 (QA's dateedit r2: a date the draft already held got "didn't update"): one Editing
 * line was added for edit_form's already_set. It reads the same under every config; nothing else changed.
 *
 * Re-taken on purpose on 16 Nov 2026 (fix batch item 2, "final warning", Pau's ruling): one Card replies line was added
 * for level_not_named. It reads the same under every config; nothing else changed.
 *
 * Re-taken on purpose on 16 Nov 2026 (the retry guard, QA): one Card replies line was added for stop_retrying. It reads
 * the same under every config; nothing else changed.
 *
 * Updated on purpose on 16 Nov 2026 (fix-name, live s10; QA's review of #1050): one line in the card replies teaches
 * propose_form's name_corrected fact ("I changed the name on the card from <from> to <to>; nothing else changed.").
 * It names no app, place, staff system or form key; nothing else in either text changed.
 *
 * Re-taken on purpose on 16 Nov 2026 (never guess, QA): a Replies line (never guess a pronoun) and a Which form line
 * (pasted text with no ask gets one question) were added, and the termination-offense line now says "the manager tells
 * in their own words". All read the same under every config; nothing else changed. The same day (Pau): the pronoun line
 * became "the employee by first name every time" (full names when two share a first name), and title_differs' template
 * says <first name> instead of <them>. Then (QA, after the live runs): "never the full name in your words (the card shows
 * it)", the full name only when two people share a first name; the card reply's first line names the employee in bold by
 * first name (it said **<employee>**, which contradicted the rule), and the lines that say which person it is keep the full
 * name. Then (QA and Pau): both lines say <reply_name>, which code decides (propose_form / edit_form's reply_name).
 *
 * Re-taken on purpose on 20 Nov 2026 (QA item 22, Pau's call: prior discipline on file): the prior actions line now lets
 * propose_form's prior_on_file fill prior actions when the manager states none, and says it never sets the level. It
 * reads the same under every config; nothing else changed.
 *
 * Re-taken on purpose on 20 Nov 2026 (QA item 23, a drafted team message reversed "isnt realostic"): one Replies line was
 * added: a drafted message keeps the manager's own statements, negations included. It reads the same under every config;
 * nothing else changed.
 *
 * Re-taken on purpose on 20 Nov 2026 (item 18, Pau via QA: which-one choices that read alike): the which_form_question
 * line lists each form's choice line as given (status, date, salon, created time when two match) instead of "by date".
 * It reads the same under every config; nothing else changed.
 *
 * Re-taken on purpose on 16 Nov 2026 (QA, c019 in #1056): one line in "Which form" teaches that "Create a <form> from this
 * conversation" / "make it a <form> instead" for the same person and incident is the same request, not
 * new_form_evidence. It names no app, place, staff system or form key; nothing else changed.
 *
 * Updated on purpose on 16 Nov 2026 (Pau's MSB ruling): the conduct line is split; a guest complaint stays the Standards
 * of Conduct, and "MSB" / "must see behaviors" is "Other — Must See Behaviors". One line; it names no app, place, staff
 * system or form key.
 *
 * Updated on purpose on 16 Nov 2026 (QA's live findings: the reply says what the code did): the finalized-form line
 * words the reply from revision_draft.reused (a reused revision draft is never called new), and a new line teaches
 * edit_form's form_state ("It's saved on the draft", never "press Create"); the payroll line adds edit_form's
 * payroll_amount_missing (ask the amount in one question), and the stated line adds ", as you said" only for
 * stated_this_turn. No app, place, staff system or form key.
 *
 * Re-taken on purpose on 20 Nov 2026 (QA's live retest of #1147: a story with no ask was restated word for word, "told
 * her … she refused"): the not-a-request line says what it is in Sunny's own words with the person's first name, never
 * the manager's text typed back or a pronoun. It reads the same under every config; nothing else changed.
 *
 * Re-taken on purpose on 20 Nov 2026 (QA: "show me forms for Tes" opened another person's draft): the find_past_forms
 * close-spelling line now says did_you_mean (end with ask_exactly, open nothing) in place of close_spelling_of ("Opening
 * **<on_file>**'s form."). It reads the same under every config; nothing else changed.
 *
 * Re-taken on purpose on 20 Nov 2026 (Pau's live chat: a refused find_past_forms told as "a lookup issue on my end"): one
 * Replies line was added: a tool's refusal is never told to the manager as a lookup problem or "try again". It reads the
 * same under every config; nothing else changed.
 *
 * Updated on purpose on 20 Nov 2026 (Pau's ruling via QA, c091): a Corrective Action may cite two headings when the
 * manager describes two offenses ("<heading>; <heading>", never more than two); the clock-out line no longer says "a card
 * cites one heading" (closing early is part of the same Attendance offense). No app, place, staff system or form key.
 *
 * Re-taken on purpose on 20 Nov 2026 (QA's code audit of coach_team, item C: "yes please", "go ahead and make them"
 * went to wrong_tool): the coach_team line now sends any answer to its confirmation to coach_team, with four example
 * answers. It names no app, place, staff system or form key; nothing else changed.
 *
 * Re-taken on purpose on 20 Nov 2026 (QA's f081: forms-on-file lists miscounted): one Replies line was added: a list of
 * forms on file copies find_past_forms' counts, never adds rows itself, never puts one person's forms under another's name,
 * and says "(archived)" beside an archived form (archived drafts only when asked). It reads the same under every config; nothing else changed.
 *
 * Re-taken on purpose on 21 Nov 2026 (QA2, #1172's live test: a switched-from card never created was said to be in Form
 * Monitoring): the after-a-switch line now says the created form is left as it is only when form_changed's earlier_created
 * is true, and one Card replies line was added for form_changed with earlier_created false. No app, place, staff system or
 * form key; nothing else changed.
 *
 * Re-taken on purpose on 21 Nov 2026 (QA2; a real manager's exit form, "immideate volunatary termination", ticked no
 * type): the Exit line gained one sentence asking for exit_how with exit_how_evidence on a resignation. No app, place,
 * staff system or form key; nothing else changed.
 *
 * Re-taken on purpose on 22 Nov 2026 (port from Ask Bubbles #1021, U26): the exit_unset/exit_ticks line now says
 * exit_ticks is never "as you said", states card.how_resigned, and says exit_method is how the person told the company
 * they were leaving, never how someone reached them. It reads the same under every config; nothing else changed.
 * Re-taken on purpose on 22 Nov 2026 (port from Ask Bubbles #1028, U16): one line was added after the level-and-payroll
 * evidence line: a request that names the level ("a verbal CA") is that level's evidence. It reads the same under
 * every config; nothing else changed.
 * Re-taken on purpose on 22 Nov 2026 (port from Ask Bubbles #1026, U21): one line was added after the "policy and no
 * person" line: "make this for <B> instead of <A>" / "the same corrective action but for <B>" go with same_card_evidence
 * (kind same_form or this_card_for) and copied_from_card. It reads the same under every config; nothing else changed.
 * Re-taken on purpose on 22 Nov 2026 (port from Ask Bubbles #1038, "saved ≠ card"): the earlier-card line now names the
 * "[card shown under this reply: …]" line instead of the app note, and one line was added after it: a card comes only
 * from propose_form, never card lines written on a turn without it. It reads the same under every config; nothing else
 * changed.
 * Re-taken on purpose on 22 Nov 2026 (port from Ask Bubbles #1044, U16): the "Open / edit / pull up / show me" line now
 * says a form referred to as one that exists is a form on file whatever the verb ("put up" included), and only words
 * asking to make one start a card; one line was added before the "In the format of" line ("with all the same
 * information" copies the form on file); the level-evidence line no longer gives "put up the verbal CA" as an example.
 * It reads the same under every config; nothing else changed.
 * Re-taken on purpose on 22 Nov 2026 (port from Ask Bubbles #1034 + #1036, U22 and B6): one line was added after the
 * exit_dates line: an exit card's reads_back is the only exit lines the reply reads back, every one is saved at Create,
 * and a detail added after the card reaches the form only through propose_form. It reads the same under every config;
 * nothing else changed.
 *
 * Re-taken on purpose on 21 Nov 2026 (Pau: a search of past forms by topic, FORM_TOPIC_SEARCH_ENABLED): one Replies line
 * was added: forms on file about a topic ("any forms about cash handling at my <place>s this month?", "who's been written
 * up for dress code?") call find_past_forms with about and no employee_name, list each form as given, say the counts, and
 * "showing N of M". It uses the config's place word; nothing else changed.
 */

const fixture = (name: string): string => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

/** A made-up app: no word of it is Sunny's. */
const FAKE: AppConfig = {
  ...SUNNY_CONFIG,
  appName: "Zippo",
  brandName: "Quartz Cafe",
  locationWord: "kiosk",
  locationWordPlural: "kiosks",
  staffSystem: "Rotaplan",
  formKeys: { exit: "qc-leaving", corrective: "qc-warn", coaching: "qc-coach", followUpCoaching: "qc-follow" },
};

afterEach(() => setAppConfigForTests());

describe("app config: Sunny's text is unchanged", () => {
  it("the rules book is byte-identical", () => {
    expect(appConfig()).toBe(SUNNY_CONFIG);
    expect(rulesBookText()).toBe(fixture("sunny-rules-book.txt"));
  });

  it("the system prompt is byte-identical", () => {
    expect(agentLoopRules()).toBe(fixture("sunny-system-rules.txt"));
  });

  it("Sunny's config holds the values the loop used as literals", () => {
    expect(SUNNY_CONFIG.appName).toBe("Sunny");
    expect(SUNNY_CONFIG.locationWord).toBe("salon");
    expect(SUNNY_CONFIG.staffSystem).toBe("Woven");
    expect(SUNNY_CONFIG.formKeys).toEqual({ exit: "stc-exit", corrective: "dpoa", coaching: "coaching", followUpCoaching: "follow-up-coaching" });
    expect(SUNNY_CONFIG.locations().length).toBeGreaterThan(0);
  });
});

/** Tool and field names are the contract with the model, not wording: they are removed before looking for a word. */
const withoutIdentifiers = (text: string): string => text.replace(/[A-Za-z]*_[A-Za-z_]*/g, "").replace(/<[^>]*>/g, "").replace(/\bsalon (?:set to|:)/g, "").replace(/\b(?:salon|salons)\s*:/g, "");

describe("app config: another app's words", () => {
  it("changes every word in the rules book and the prompt", () => {
    setAppConfigForTests(FAKE);
    const rules = withoutIdentifiers(agentLoopRules());
    for (const word of ["salon", "Salon", "Woven", "stc-exit", "dpoa", "Sunny", "Sun Tan City"]) {
      expect(rules, `"${word}" is still in the prompt`).not.toContain(word);
    }
    expect(rules).toContain("kiosk");
    expect(rules).toContain("Rotaplan");
    expect(rules).toContain("qc-leaving");
    expect(rules).toContain("You are Zippo");
    expect(rules).toContain("Quartz Cafe");
    expect(rulesBookText(FAKE)).toBe(rulesBookText());
  });

  it("changes the tool descriptions and the per-turn facts", () => {
    setAppConfigForTests(FAKE);
    const described = JSON.stringify(agentLoopTools().map((tool) => ({ d: tool.description, s: tool.input_schema })));
    const words = withoutIdentifiers(described.replace(/"salon":/g, '"":'));
    expect(words).not.toMatch(/\bsalons?\b/i);
    expect(words).not.toContain("Sunny");
    expect(described).toContain("kiosk");
    const facts = agentLoopSystem({ managerName: "Test Testy", role: "manager", salons: ["Kiosk A"], today: "2026-11-02", templates: [], headings: [], openFormId: null });
    expect(facts).toContain("Their kiosks: Kiosk A.");
    expect(facts).toContain("(kiosk local date)");
    expect(facts).not.toMatch(/salon/i);
  });

  it("swapping back restores Sunny's words", () => {
    setAppConfigForTests(FAKE);
    expect(agentLoopRules()).not.toBe(fixture("sunny-system-rules.txt"));
    setAppConfigForTests();
    expect(agentLoopRules()).toBe(fixture("sunny-system-rules.txt"));
  });
});

/** A made-up company's rules-book content (Phase 1 of the loop port, QA 21 Nov 2026): none of it is Sunny's. */
const FAKE_CONTENT: AppConfig["content"] = ({ place }) => ({
  notPeopleExamples: "\"Basket Size\" and other metrics",
  otherTopics: "a kiosk wipe-down left undone",
  statsReports: null,
  terminationApproval: "owner approval",
  timeZone: { label: "Pacific time", short: "Pacific", abbrev: "PT" },
  whoRules: [],
  policyRulings: ["A spilled order at the " + place + " is the Food Safety section."],
  sectionRulings: [],
  attendanceRules: [],
  underPerformanceReplies: [],
  metricsRule: null,
  volumeRule: null,
  statsGuideRule: null,
  examples: {
    addedTopic: "weekly coaching on upsells",
    addedTopicQuestion: "Who is this weekly upsell coaching for?",
    namedPolicy: "cite the uniform policy",
    misspelledPolicy: "ca for the unifrom policy",
    formAbout: "the 10/31 one about the late delivery",
    spellingFixes: "\"recieved\" → \"received\"",
    becausePlace: "late because of traffic on Main",
    ruleInOtherSection: "\"No phones at the till\" is in Workplace Conduct",
    approvedTermination: "the owner approved her termination",
    rewordNoLink: "\"dropped the tray and left\" is \"She dropped the tray. She left.\"",
    policyLine: "Food Safety Policy, JBA Policy Manual p.3",
    position: "who are my baristas",
    howTo: "\"how do I close the till\"",
    businessDocs: "the store handbook",
  },
  toolExamples: { formAbout: "the late delivery", position: "baristas", placesNamed: "\"north kiosk\"" },
});

describe("app config: another company's content in the rules book (Phase 1 of the loop port)", () => {
  // Sunny's rulings, metrics, reports, time zone, approver, page name and example phrases (src/config/company/agent-loop.ts).
  const SUNNY_CONTENT_WORDS = [
    "Under Performance", "Club Close", "PPTA", "LPSVA", "tans", "Daily Stats", "Sales Totals", "Comp figures", "DM/HR",
    "Central", "CT)", "Form Monitoring", "Must See", "sanitation", "EFT", "animals in the workplace", "key holdr",
    "Dodge", "No tanning", "Employee Discounts", "tanning consultants", "beds between clients", "Attendance Policy",
    "Late Opening", "Time Records", "Animals in the Workplace", "Handling Theft", "doctor's note", "the reviews SOP",
  ];

  it("takes every one of Sunny's content words from the content, and leaves out a rule the company has no use for", () => {
    const fake: AppConfig = { ...FAKE, content: FAKE_CONTENT, formsPageName: "Forms Ledger" };
    const text = rulesBookText(fake);
    for (const word of SUNNY_CONTENT_WORDS) expect(text, `"${word}" is still in the rules book`).not.toContain(word);
    expect(text).toContain("Forms Ledger");
    expect(text).toContain("the owner approved her termination");
    expect(text).toContain("Pacific time");
    expect(text).toContain("A spilled order at the kiosk is the Food Safety section.");
    // No stats reports and no stats guide: read_stats is never named, and no rule is left empty.
    expect(text).not.toContain("read_stats");
    expect(text).toContain("Google review figures come only from read_reviews. Give only the figures they return");
    expect(text).not.toMatch(/^- (?:null|undefined)?$/m);
  });

  it("Sunny's own content holds every one of those words (so the check above is not vacuous)", () => {
    const text = rulesBookText();
    for (const word of SUNNY_CONTENT_WORDS) expect(text, `"${word}" is not in Sunny's rules book`).toContain(word);
  });
});

describe("app config: the policy guards' headings (Phase 1 of the loop port)", () => {
  it("Sunny's guards check the headings and the Must See Behaviors ruling the code used", () => {
    expect(SUNNY_CONFIG.policyGuards.headings).toEqual({ attendance: "Attendance", lateOpening: "Late Opening", conduct: "Standards of Conduct" });
    expect(citesMustSee("Other — Must See Behaviors")).toBe(true);
    expect(citesMustSee("Other — MSB")).toBe(true);
    expect(saysMustSee("verbal for her MSBs")).toBe(true);
    expect(namesMustSee("must see behaviors were missed")).toBe(true);
    expect(saysMustSee("she was late")).toBe(false);
  });

  it("a company with no said-only Other topic switches those guards off", () => {
    setAppConfigForTests({ ...FAKE, policyGuards: { headings: { attendance: null, lateOpening: null, conduct: null }, saidOnlyOther: null } });
    expect(citesMustSee("Other — Must See Behaviors")).toBe(false);
    expect(saysMustSee("MSB")).toBe(false);
    expect(namesMustSee("must see behaviors")).toBe(false);
  });

  it("tools.ts and policy-fit.ts name no manual heading in their code: the guards take them from the config", () => {
    const strip = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const file of ["tools.ts", "policy-fit.ts"]) {
      const code = strip(readFileSync(new URL(`./${file}`, import.meta.url), "utf8"));
      expect(code, file).not.toMatch(/["'`]Late Opening["'`]|["'`]Attendance["'`]|["'`]Standards of Conduct["'`]/);
      expect(code, file).not.toMatch(/standards of conduct\/i/);
    }
  });
});

describe("app config: tool-description examples and the prompt's reports (Phase 1 of the loop port)", () => {
  it("another company's examples reach the tool descriptions, and with no stats reports the prompt names no read_stats", () => {
    setAppConfigForTests({ ...FAKE, content: FAKE_CONTENT });
    const described = JSON.stringify(agentLoopTools().map((tool) => tool.input_schema));
    for (const word of ["rooms ready between guests", "tanning consultants", "kearney", "Altoona"]) expect(described, word).not.toContain(word);
    expect(described).toContain("the late delivery");
    expect(described).toContain("baristas");
    expect(agentLoopRules()).not.toContain("- read_stats:");
    expect(agentLoopRules()).not.toContain("Daily Stats");
  });

  it("Sunny's own descriptions keep its examples and the read_stats line", () => {
    const described = JSON.stringify(agentLoopTools().map((tool) => tool.input_schema));
    expect(described).toContain("getting rooms ready between guests");
    expect(agentLoopRules()).toContain("- read_stats: Daily Stats, Sales Totals and Comp figures for the manager's salons");
  });
});

describe("app config: metrics and the forms page (Phase 1 of the loop port)", () => {
  it("Sunny's metrics and page name are the ones the code used", () => {
    expect(SUNNY_CONFIG.formsPageName).toBe("Form Monitoring");
    expect(SUNNY_CONFIG.metrics.account.flags).toBe("gi");
    expect("Below in PPTA, Club Close % and Spa%".match(SUNNY_CONFIG.metrics.account)).toEqual(["PPTA", "Club Close %", "Spa%"]);
  });

  it("another company's page name reaches the tool descriptions, and no tool code names Sunny's metrics or page", () => {
    setAppConfigForTests({ ...FAKE, formsPageName: "Forms Ledger" });
    const described = JSON.stringify(agentLoopTools().map((tool) => tool.description));
    expect(described).toContain("Forms Ledger");
    expect(described).not.toContain("Form Monitoring");
    const strip = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const file of ["tools.ts", "run.ts", "data-tools.ts", "rules-book.ts"]) {
      const code = strip(readFileSync(new URL(`./${file}`, import.meta.url), "utf8"));
      expect(code, file).not.toContain("Form Monitoring");
      expect(code, file).not.toMatch(/PPTA|LPSVA|Club\\s\+Close/);
    }
  });
});

describe("app config: no app literal is left in the loop's code", () => {
  const strip = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const file of ["tools.ts", "run.ts", "rules-book.ts", "prompt.ts"]) {
    it(`${file} takes the staff system, the form keys and the location list from the config`, () => {
      const code = strip(readFileSync(new URL(`./${file}`, import.meta.url), "utf8"));
      // Field names (inactive_in_woven, salon_from_woven) are the model contract; a word in a string is not.
      expect(code).not.toMatch(/(?<![\w])Woven(?![\w])/);
      expect(code).not.toMatch(/["'`](?:stc-exit|dpoa|follow-up-coaching)["'`]/);
      expect(code).not.toContain("PRODUCTION_SALONS");
      expect(code).not.toMatch(/\bSunny\b/);
    });
  }
});
