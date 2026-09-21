import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  ACTIVITY_CATEGORIES,
  ACTIVITY_FEATURES,
  CATEGORY_FEATURE,
  CATEGORY_LABEL,
  FEATURE_LABEL,
  categoryForTemplateKey,
  categoryLabel,
  classifyChatTurn,
  classifyQuestionText,
} from "./taxonomy";
import {
  DEFAULT_RANGE,
  EMPTY_FILTERS,
  bucketFor,
  hasActiveFilters,
  parseFilters,
  resolveWindow,
  serializeFilters,
} from "./filters";
import { changeAgainst } from "./queries";
import { ROLES } from "@/lib/permissions";

/* ------------------------------------------------------------ taxonomy --- */

describe("the taxonomy matches the database", () => {
  /*
   * THE ENUMS ARE DECLARED TWICE — once in the migration, once in TypeScript —
   * and a category added to one and not the other is silent: the database
   * returns a key, the label lookup misses, and a whole class of usage reads as
   * a raw identifier or vanishes from a chart. These read the migration as text
   * rather than trusting the two to be kept in step by hand.
   */
  const migrationsDir = join(process.cwd(), "supabase", "migrations");
  const migrations = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(join(migrationsDir, name), "utf8"))
    .join("\n");

  /**
   * Reads BOTH declaration styles, because a Postgres enum grows in two ways:
   * the original `create type ... as enum (...)` and every later
   * `alter type ... add value`. Reading only the first would have passed while
   * the nine business topics existed in TypeScript and not in the database.
   */
  function enumValues(typeName: string): string[] {
    const created = migrations.split(`create type public.${typeName} as enum`)[1];
    const body = created?.split(");")[0] ?? "";
    const initial = [...body.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);

    const added = [
      ...migrations.matchAll(
        new RegExp(
          `alter type public\\.${typeName} add value(?: if not exists)? '([a-z_]+)'`,
          "g",
        ),
      ),
    ].map((match) => match[1]);

    return [...new Set([...initial, ...added])];
  }

  it("declares exactly the categories the migration does", () => {
    expect([...ACTIVITY_CATEGORIES].sort()).toEqual(
      enumValues("activity_category").sort(),
    );
  });

  it("declares exactly the features the migration does", () => {
    expect([...ACTIVITY_FEATURES].sort()).toEqual(
      enumValues("activity_feature").sort(),
    );
  });

  it("gives every category a label and an owning feature", () => {
    for (const category of ACTIVITY_CATEGORIES) {
      expect(CATEGORY_LABEL[category], category).toBeTruthy();
      expect(ACTIVITY_FEATURES).toContain(CATEGORY_FEATURE[category]);
    }
    for (const feature of ACTIVITY_FEATURES) {
      expect(FEATURE_LABEL[feature], feature).toBeTruthy();
    }
  });

  it("uses role names Postgres will accept as app_user_role", () => {
    /*
     * `filters.role` is passed straight into `analytics_*` as a typed
     * `app_user_role` argument. A role this app knows and the enum does not is
     * not a mislabel — it is a 22P02 from Postgres and an error page, and it
     * would only appear when somebody actually picked that role in the filter.
     * The enum is declared in the app_users migration; this reads it there.
     */
    const appUsers = readFileSync(
      join(process.cwd(), "supabase/migrations/20260904006000_app_users.sql"),
      "utf8",
    );
    const body =
      appUsers.split("create type public.app_user_role as enum")[1]?.split(");")[0] ?? "";
    const dbRoles = [...body.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);

    expect(dbRoles.length).toBeGreaterThan(0);
    expect([...ROLES].sort()).toEqual(dbRoles.sort());
  });

  it("shows an unknown key as itself rather than folding it into Other", () => {
    /*
     * A category a later migration adds must read as the thing it is, so the
     * gap is visible. "Other" would hide a whole kind of usage behind a word
     * that looks deliberate.
     */
    expect(categoryLabel("something_new")).toBe("something_new");
  });
});

describe("a chat turn is classified by evidence, strongest first", () => {
  const NOTHING = { hadReportContext: false, citedCategories: [] };

  it("takes the form family from the template the answer proposed", () => {
    /*
     * The strongest signal: the answer named a template key, so the family is a
     * fact rather than a reading. It beats an attached report and citations,
     * because producing the form is what the manager came for.
     */
    expect(
      classifyChatTurn({
        ...NOTHING,
        proposedTemplateKey: "dpoa",
        hadReportContext: true,
        citedCategories: ["policies_compliance"],
        question: "what is the attendance policy",
      }),
    ).toBe("corrective_action");

    expect(
      classifyChatTurn({ ...NOTHING, proposedTemplateKey: "coaching" }),
    ).toBe("coaching_form");
    expect(
      classifyChatTurn({ ...NOTHING, proposedTemplateKey: "follow-up-coaching" }),
    ).toBe("coaching_form");
    expect(
      classifyChatTurn({ ...NOTHING, proposedTemplateKey: "tsd-epp" }),
    ).toBe("epp");
    expect(
      classifyChatTurn({ ...NOTHING, proposedTemplateKey: "policy-review" }),
    ).toBe("policy_review");
  });

  it("keeps the DPOA rename from splitting one family in two", () => {
    /*
     * The template NAME became "Corrective Action Form"; the KEY stayed `dpoa`.
     * Matching on the key is what stops the rename creating a second category.
     */
    expect(categoryForTemplateKey("dpoa")).toBe("corrective_action");
  });

  it("calls an unrecognised template a form request rather than guessing", () => {
    expect(
      classifyChatTurn({ ...NOTHING, proposedTemplateKey: "some-new-template" }),
    ).toBe("form_request");
    expect(
      classifyChatTurn({ ...NOTHING, offeredFormChoices: true }),
    ).toBe("form_request");
  });

  it("calls a turn carrying an attached report Daily Stats", () => {
    expect(
      classifyChatTurn({
        ...NOTHING,
        hadReportContext: true,
        citedCategories: ["policies_compliance"],
        question: "how are my beds doing",
      }),
    ).toBe("daily_stats");
  });

  it("takes the topic from the categories of the documents it cited", () => {
    /*
     * Authoritative metadata: the category was chosen when the document was
     * uploaded, and the citation reports it. No reading of the question needed.
     */
    expect(
      classifyChatTurn({ ...NOTHING, citedCategories: ["leadership_coaching"] }),
    ).toBe("coaching_guidance");
    expect(
      classifyChatTurn({ ...NOTHING, citedCategories: ["equipment_procedures"] }),
    ).toBe("equipment_maintenance");
    expect(
      classifyChatTurn({ ...NOTHING, citedCategories: ["bonuses_compensation"] }),
    ).toBe("pay_bonus");
  });

  it("lets the most-cited category win", () => {
    expect(
      classifyChatTurn({
        ...NOTHING,
        citedCategories: ["training", "policies_compliance", "policies_compliance"],
      }),
    ).toBe("policy_question");
  });

  it("skips documents filed as 'other' rather than counting them", () => {
    /*
     * Six of the forty documents in this corpus are "other". A turn citing four
     * of them and one policy document is a policy question, not an unclassified
     * one — "other" says nothing about the topic.
     */
    expect(
      classifyChatTurn({
        ...NOTHING,
        citedCategories: ["other", "other", "other", "safety"],
      }),
    ).toBe("safety_hr");
  });

  it("reads the question only when nothing deterministic explained the turn", () => {
    expect(
      classifyChatTurn({ ...NOTHING, question: "how do I replace a lamp" }),
    ).toBe("equipment_maintenance");
    expect(
      classifyChatTurn({ ...NOTHING, question: "when does payroll close" }),
    ).toBe("pay_bonus");
    expect(
      classifyChatTurn({ ...NOTHING, question: "I need to write someone up" }),
    ).toBe("corrective_action");
  });

  /**
   * ==========================================================================
   * THE QUESTIONS THE PRODUCT ITSELF OFFERS MUST LAND IN THE RIGHT BAR
   * ==========================================================================
   *
   * Every one of these is a chip on the Overview band — see
   * `lib/ai/quick-questions.ts` — so they are the highest-volume questions in
   * the product and the ones the adoption chart most needs to get right.
   *
   * "Which salons need my attention today?" named no metric and no report, so
   * it fell through the whole ladder to `general_guidance`: the Daily Stats
   * bar understated its own best case, and the District Manager chip was
   * invisible. Step 2 does not rescue it — `hadReportContext` means the
   * manager came from a report TAB carrying pointers, which a homepage chip
   * never does, however many report families the question then routes to.
   */
  it.each([
    "Which salons need my attention today?",
    "Where is my region losing revenue based on the latest data?",
    "Show me the most recent Daily Stats and what I need to focus on today.",
  ])("files the report chip %s under Daily Stats", (question) => {
    expect(classifyQuestionText(question)).toBe("daily_stats");
    // And through the full ladder, with no deterministic evidence to help it.
    expect(classifyChatTurn({ ...NOTHING, question })).toBe("daily_stats");
  });

  it("leaves the non-report chips where they were", () => {
    /*
     * The three new terms must not have stolen the rest of the band. A
     * coaching question is still coaching guidance and a policy question is
     * still filed by its own topic.
     */
    expect(classifyQuestionText("Help me prepare for a coaching conversation.")).toBe(
      "coaching_guidance",
    );
    /*
     * `policy_question`, not `corrective_action`: the chip says "policy say
     * about attendance", which does not contain the contiguous phrase
     * "attendance policy" that the corrective-action list claims. The test
     * below pins that phrase deliberately; this pins the chip as it is
     * actually worded.
     */
    expect(classifyQuestionText("What does our policy say about attendance?")).toBe(
      "policy_question",
    );
    expect(classifyQuestionText("Create a coaching form for a performance concern.")).toBe(
      "coaching_form",
    );
  });

  it("prefers the longer phrase over the general word inside it", () => {
    /*
     * "coaching form" must not be decided by "coaching", and "attendance
     * policy" must not be decided by "policy".
     */
    expect(classifyQuestionText("send me the coaching form")).toBe("coaching_form");
    expect(classifyQuestionText("what is the attendance policy")).toBe(
      "corrective_action",
    );
  });

  it("matches whole words, so 'epp' is not found inside 'stepped'", () => {
    expect(classifyQuestionText("he stepped away from the desk")).not.toBe("epp");
    expect(classifyQuestionText("start an epp")).toBe("epp");
  });

  it("calls an ordinary question general guidance rather than inventing a topic", () => {
    expect(
      classifyChatTurn({ ...NOTHING, question: "thank you, that helps" }),
    ).toBe("general_guidance");
  });

  it("says unclassified when there was no evidence at all, not general guidance", () => {
    /*
     * Kept separate on purpose. If the evidence pipeline ever breaks, it should
     * appear as its own bar on the chart rather than quietly inflating a
     * category that means something specific.
     */
    expect(classifyChatTurn({ ...NOTHING })).toBe("unclassified");
    expect(classifyChatTurn({ ...NOTHING, question: "   " })).toBe("unclassified");
  });
});

/**
 * Source with its comments removed, so an assertion matches CODE.
 *
 * This project's standing rule for tests that read source text, and the files
 * checked below are exactly why it exists: `record.ts` and `/api/chat/route.ts`
 * both EXPLAIN, at length, that no question is ever persisted. Matching raw
 * text for the word "question" therefore fails on the sentence documenting the
 * guarantee rather than on any breach of it — the test would be satisfied only
 * by deleting the explanation, which is the opposite of what anyone wants.
 *
 * Block comments first, then line comments, then whitespace collapsed. A `//`
 * inside a string literal would be stripped too; nothing here contains one, and
 * the alternative is a parser for a test helper.
 */
function statementsOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("no question text can be persisted", () => {
  /*
   * THE GUARANTEE IS STRUCTURAL, and this is what enforces it: the event table
   * has no column a prompt could go in, and the writer has no field for one.
   * A future edit that adds either has to delete this test to do it.
   */
  const migrationsDir = join(process.cwd(), "supabase", "migrations");
  const eventsMigration = readFileSync(
    join(migrationsDir, "20260911001000_activity_events.sql"),
    "utf8",
  );

  it("declares no text-bearing column on activity_events", () => {
    const table =
      eventsMigration
        .split("create table if not exists public.activity_events")[1]
        ?.split(");")[0] ?? "";

    /*
     * COLUMN NAMES ONLY — the first identifier on each declaration line.
     * Scanning the whole block matched the TYPE `text` on `location_ref text`
     * and failed for the opposite of the reason this test exists.
     */
    const columnNames = table
      .split("\n")
      .map((line) => line.trim())
      .filter(
        (line) =>
          /^[a-z_]+\s+[a-z]/.test(line) &&
          !line.startsWith("constraint") &&
          !line.startsWith("*") &&
          !line.startsWith("/*"),
      )
      .map((line) => line.split(/\s+/)[0]);

    expect(columnNames.length).toBeGreaterThan(5);
    const statements = columnNames.join(" ");

    for (const forbidden of [
      "question",
      "prompt",
      "answer",
      "excerpt",
      "content",
      "message",
      "text",
      "hash",
    ]) {
      expect(statements, `activity_events declares ${forbidden}`).not.toMatch(
        new RegExp(`\\b${forbidden}\\b`),
      );
    }
  });

  it("gives the event writer no field for text", () => {
    const writer = readFileSync(
      join(process.cwd(), "src/lib/analytics/record.ts"),
      "utf8",
    );
    /*
     * COMMENTS STRIPPED FIRST, per this project's standing rule for tests that
     * match on source text: the file EXPLAINS the guarantee it must not break —
     * "there is no field for a question, a prompt or an answer" — so raw-text
     * matching hits the explanation and fails on the very prose that documents
     * the rule. What is asserted is the DECLARED FIELDS.
     */
    const contract = statementsOnly(
      writer.split("export interface ActivityRecord")[1]?.split("}")[0] ?? "",
    );
    expect(contract.length).toBeGreaterThan(0);
    for (const forbidden of ["question", "prompt", "answer", "text", "excerpt"]) {
      expect(contract, `ActivityRecord carries ${forbidden}`).not.toMatch(
        new RegExp(`\\b${forbidden}\\b`),
      );
    }
  });

  it("never passes the question on to the recorder", () => {
    /*
     * THE QUESTION IS READ, NEVER WRITTEN, and this asserts that as a property
     * of the whole route rather than of one call.
     *
     * IT USED TO COUNT OCCURRENCES inside a single named call, and a refactor
     * broke it twice without any privacy guarantee changing — first when the
     * recorder was awaited, then when the turn lifecycle split into open and
     * close. A guard that fails on rearrangement teaches people to edit the
     * guard. So the rule is stated directly: every mention of the question in
     * this route is an argument to a classifier or to the validator, and the
     * two calls that PERSIST anything carry no text field at all.
     */
    const route = statementsOnly(
      readFileSync(join(process.cwd(), "src/app/api/chat/route.ts"), "utf8"),
    );

    /* The only three things allowed to receive it, all of them read-only. */
    const READERS = ["classifyChatTurn({", "classifyTurnKind(", "requireString("];

    const mentions = [...route.matchAll(/[\w.]*\bbody\.question\b/g)];
    expect(mentions.length, "the question is never read at all").toBeGreaterThan(0);

    for (const mention of mentions) {
      const before = route.slice(Math.max(0, mention.index - 400), mention.index);
      const reader = READERS.find((fn) => before.lastIndexOf(fn) > before.lastIndexOf(");"));
      expect(
        reader,
        `body.question at ${mention.index} does not reach a classifier or the validator`,
      ).toBeTruthy();
    }

    /*
     * AND NOTHING THAT WRITES A ROW DECLARES A FIELD FOR TEXT. `openTurn` and
     * `closeTurn` are the two calls that reach the database; a `question:` key
     * inside either is only ever the classifier's own argument, so the record's
     * own fields are checked against the forbidden list.
     */
    for (const call of ["openTurn({", "closeTurn(turnId, {"]) {
      const body = route.split(call)[1]?.split("});")[0] ?? "";
      expect(body.length, `${call} is not in the route`).toBeGreaterThan(0);

      /* Strip the classifier arguments; what remains is the persisted record. */
      const persisted = body.replace(/classify\w+\(\{[\s\S]*?\}\)/g, " ").replace(
        /classify\w+\([^)]*\)/g,
        " ",
      );
      for (const forbidden of ["question", "prompt", "answer", "excerpt", "content"]) {
        expect(persisted, `${call} persists ${forbidden}`).not.toMatch(
          new RegExp(`\\b${forbidden}\\b`),
        );
      }
    }
  });
});

/* ------------------------------------------------------------- filters --- */

describe("filters survive the round trip through a URL", () => {
  it("restores everything that was set", () => {
    const filters = {
      range: "90d" as const,
      from: null,
      to: null,
      district: "Patterson, Madeline",
      salonId: "3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      role: "salon_director" as const,
      actorId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      inactiveOnly: true,
    };
    expect(
      parseFilters(Object.fromEntries(new URLSearchParams(serializeFilters(filters)))),
    ).toEqual(filters);
  });

  it("omits an unset filter from the query string entirely", () => {
    expect(serializeFilters(EMPTY_FILTERS)).toBe("");
  });

  it("drops a salon or leader id that is not a uuid", () => {
    /*
     * Both are passed to a Postgres function as typed arguments. A junk value
     * must come back as "no filter" rather than as an error page from the
     * database, which is what a hand-edited URL would otherwise produce.
     */
    const parsed = parseFilters({ salon: "'; drop table", leader: "42" });
    expect(parsed.salonId).toBeNull();
    expect(parsed.actorId).toBeNull();
  });

  it("drops a role this build does not know", () => {
    expect(parseFilters({ role: "supreme_leader" }).role).toBeNull();
  });

  it("falls back to the default range rather than trusting a junk one", () => {
    expect(parseFilters({ range: "since_forever" }).range).toBe(DEFAULT_RANGE);
  });

  it("ignores half a custom window", () => {
    /*
     * One end of a range is not a range. Honouring it would pair a typed date
     * with a default boundary the reader never chose and never sees.
     */
    const parsed = parseFilters({ from: "2026-01-01" });
    expect(parsed.from).toBeNull();
    expect(parsed.to).toBeNull();
  });

  it("knows when something is actually narrowing the view", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, district: "West" })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, inactiveOnly: true })).toBe(true);
  });

  it("treats inactive-only as on for exactly \"1\"", () => {
    expect(parseFilters({ inactive: "1" }).inactiveOnly).toBe(true);
    expect(parseFilters({ inactive: "true" }).inactiveOnly).toBe(false);
    expect(parseFilters({ inactive: "maybe" }).inactiveOnly).toBe(false);
    expect(parseFilters({}).inactiveOnly).toBe(false);
  });
});

describe("the window and the one before it", () => {
  it("covers the anchor day and ends exclusively after it", () => {
    const window = resolveWindow({ ...EMPTY_FILTERS, range: "7d" }, "2026-09-11");
    expect(window.days).toBe(7);
    expect(window.from).toBe("2026-09-05T00:00:00.000Z");
    /* Exclusive: the 12th is the boundary, so the 11th is fully included. */
    expect(window.to).toBe("2026-09-12T00:00:00.000Z");
  });

  it("compares against an equally long window immediately before", () => {
    const window = resolveWindow({ ...EMPTY_FILTERS, range: "30d" }, "2026-09-11");
    expect(window.previousTo).toBe(window.from);
    const length =
      Date.parse(window.previousTo) - Date.parse(window.previousFrom);
    expect(length).toBe(Date.parse(window.to) - Date.parse(window.from));
  });

  it("treats a custom end date as the last day the reader wants included", () => {
    const window = resolveWindow(
      { ...EMPTY_FILTERS, from: "2026-09-01", to: "2026-09-07" },
      "2026-09-11",
    );
    expect(window.days).toBe(7);
    expect(window.to).toBe("2026-09-08T00:00:00.000Z");
  });

  it("starts this month and this year on their first day", () => {
    expect(
      resolveWindow({ ...EMPTY_FILTERS, range: "mtd" }, "2026-09-11").from,
    ).toBe("2026-09-01T00:00:00.000Z");
    expect(
      resolveWindow({ ...EMPTY_FILTERS, range: "ytd" }, "2026-09-11").from,
    ).toBe("2026-01-01T00:00:00.000Z");
  });

  it("coarsens the bucket as the window grows", () => {
    expect(bucketFor(30)).toBe("day");
    expect(bucketFor(365)).toBe("week");
    expect(bucketFor(900)).toBe("month");
  });
});

/* -------------------------------------------------------- the comparison -- */

describe("change against the prior period", () => {
  it("refuses to divide by an empty baseline", () => {
    /*
     * THE RULE THE BRIEF ASKED FOR IN AS MANY WORDS: no misleading percentage
     * when the comparison period has insufficient data. 0 to 7 is a first week
     * of use, not "+700%", and every four-figure percentage on a dashboard of
     * this kind is a small number divided by a smaller one.
     */
    expect(changeAgainst(7, 0)).toBeNull();
    expect(changeAgainst(0, 0)).toBeNull();
  });

  it("reports a real change as a percentage", () => {
    expect(changeAgainst(150, 100)).toBe(50);
    expect(changeAgainst(50, 100)).toBe(-50);
  });
});
