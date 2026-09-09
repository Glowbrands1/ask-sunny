import { describe, expect, it } from "vitest";

import {
  FAMILY_QUESTION_TERMS,
  matchedIntents,
  REPORT_QUESTION_INTENTS,
  routeReportFamilies,
} from "./family-routing";
import { isReportingQuestion, REPORTING_QUESTION_TERMS } from "./bed-spa/question-gate";
import {
  orderReportFamilies,
  parseReportFamily,
  REPORT_FAMILY_IDS,
  REPORT_FAMILY_REASONING_ORDER,
  type ReportFamilyId,
} from "./report-families";

/**
 * ============================================================================
 * THE QUESTIONS MANAGERS ACTUALLY ASK
 * ============================================================================
 *
 * The routing's two failure modes are not symmetric, so these tests are not
 * either.
 *
 * A FALSE NEGATIVE is the bug that matters, and it has two shapes: Sunny saying
 * the knowledge base does not cover a figure that is loaded, or answering from
 * ONE family when the honest answer needed two and blaming execution for what
 * was a traffic problem. So the questions below are the ones a manager would
 * type, in their own words, and each one asserts the families it MUST reach.
 *
 * A FALSE POSITIVE costs prompt tokens. So the negative cases are only the ones
 * where that cost is real: the ordinary policy questions that are most of this
 * product's traffic.
 *
 * `toContain` rather than `toEqual` on the positive cases, deliberately. The
 * contract is "these families must be there"; an extra one is a token cost, not
 * a wrong answer, and pinning the exact set would make every future term
 * addition look like a regression.
 */

/** Asserts a question reaches at least the families the answer needs. */
function reaches(question: string, ...families: ReportFamilyId[]) {
  const routed = routeReportFamilies(question);
  for (const family of families) {
    expect(routed, `"${question}" must reach ${family}, got [${routed.join(", ")}]`).toContain(
      family,
    );
  }
}

describe("A. a broad operational question starts from the daily signal in its trend", () => {
  const QUESTIONS = [
    "What should I focus on today?",
    "what should i focus on today",
    "What should I focus on first?",
    "How are we doing today?",
    "What happened yesterday?",
    "How did we do this week?",
    "Where do I start?",
    "What are my top 3 priorities?",
    "What should I coach today?",
    "What should I say in the huddle this morning?",
  ];

  for (const question of QUESTIONS) {
    it(`routes "${question}" to Sales Totals and Salon Performance`, () => {
      reaches(question, "sales-totals", "salon-performance");
    });
  }

  it("puts Sales Totals first, because it is the immediate signal", () => {
    // Reasoning order, not tab order. A briefing reads top to bottom.
    expect(routeReportFamilies("What should I focus on today?")[0]).toBe("sales-totals");
  });
});

describe("B. tans up and revenue down is a conversion question, not a traffic one", () => {
  it("reaches the daily signal, the trend AND the traffic", () => {
    /*
     * THE COMPANION FAMILY IS THE POINT. Answering this from Sales Totals alone
     * can only say "revenue is down"; separating available opportunity from
     * weak conversion needs the traffic the Bed Usage report carries.
     */
    reaches(
      "Tans are up but revenue is down. Why?",
      "sales-totals",
      "salon-performance",
      "bed-usage",
    );
  });

  it("reaches the same families when the manager phrases it as conversion", () => {
    reaches("Are we converting the traffic we have?", "sales-totals", "bed-usage");
  });

  it("reaches them from the revenue direction alone", () => {
    reaches("Why is revenue down?", "sales-totals", "salon-performance", "bed-usage");
  });
});

describe("C. a Spa question separates execution from traffic and equipment", () => {
  const QUESTIONS = [
    "Why is Spa weak?",
    "why is spa weak",
    "Spa is low — what do I do?",
    "How do I improve Spa?",
    "What is our spa conversion?",
  ];

  for (const question of QUESTIONS) {
    it(`routes "${question}" to all three spa-relevant families`, () => {
      /*
       * Spa Engagement carries the conversion, Spa Wellness carries the
       * equipment against peers, and Bed Usage carries the traffic that is the
       * conversion's denominator. A weak Spa answer that has not looked at all
       * three cannot tell a traffic problem from an execution problem.
       */
      reaches(question, "spa-engagement", "spa-wellness", "bed-usage");
    });
  }
});

describe("D. a capital question is traffic plus utilisation plus conversion plus peers", () => {
  const QUESTIONS = [
    "Where should we add Spa equipment?",
    "Where should the next equipment dollar go?",
    "Should we add another unit at our busiest store?",
    "Is this a capital expansion opportunity?",
  ];

  for (const question of QUESTIONS) {
    it(`routes "${question}" to the three capital families`, () => {
      reaches(question, "bed-usage", "spa-wellness", "spa-engagement");
    });
  }
});

describe("E. asking what looks strong is a first-class question", () => {
  const QUESTIONS = [
    "What looks strong?",
    "what looks good",
    "What is going well?",
    "Who should I shout out?",
    "Any wins to celebrate?",
  ];

  for (const question of QUESTIONS) {
    it(`routes "${question}" to the daily read`, () => {
      reaches(question, "sales-totals", "salon-performance");
    });
  }
});

describe("questions that name a metric reach that metric's family", () => {
  const CASES: [string, ReportFamilyId][] = [
    ["What was our PPTA yesterday?", "sales-totals"],
    ["How many EFTs did we take?", "salon-performance"],
    ["Show me tans per bed by level", "bed-usage"],
    ["Is our Hydromassage getting competitive usage?", "spa-wellness"],
    ["What is our Spa Sessions per Unique Tanner per Spa Bed?", "spa-engagement"],
    ["Are we improving against last year?", "salon-performance"],
    ["How does our sunless usage compare?", "bed-usage"],
  ];

  for (const [question, family] of CASES) {
    it(`routes "${question}" to ${family}`, () => {
      reaches(question, family);
    });
  }
});

describe("ordinary policy and people questions attach no report at all", () => {
  const CLOSED = [
    "What is the dress code?",
    "What does the handbook say about breaks?",
    "How do I handle an angry customer?",
    "Who do I call when the POS is down?",
    "What is the refund policy on memberships?",
    "Can I approve time off for next week?",
    "How do I write up an employee for being late?",
    "Draft a coaching conversation about attitude",
  ];

  for (const question of CLOSED) {
    it(`stays closed for "${question}"`, () => {
      expect(routeReportFamilies(question)).toEqual([]);
    });
  }

  it("does not open on the word salon, store or location, in any family", () => {
    // The judgement recorded in the module: these are in nearly every question
    // a manager asks, so gating on them is the same as no gate at all.
    for (const family of REPORT_FAMILY_IDS) {
      expect(FAMILY_QUESTION_TERMS[family]).not.toContain("salon");
      expect(FAMILY_QUESTION_TERMS[family]).not.toContain("store");
      expect(FAMILY_QUESTION_TERMS[family]).not.toContain("location");
    }
    expect(routeReportFamilies("Who covers my salon when I am out?")).toEqual([]);
    expect(routeReportFamilies("Can I close the store early?")).toEqual([]);
  });

  it("matches on word boundaries, so a term inside a longer word does not fire", () => {
    expect(routeReportFamilies("What are the constants in this formula?")).toEqual([]);
    expect(routeReportFamilies("Do we have a spare key?")).toEqual([]);
  });

  it("returns nothing for an empty or trivial question", () => {
    expect(routeReportFamilies("")).toEqual([]);
    expect(routeReportFamilies("hello")).toEqual([]);
    expect(routeReportFamilies("thanks")).toEqual([]);
  });
});

describe("the routing is deterministic and ordered", () => {
  it("always returns families in reasoning order", () => {
    const routed = routeReportFamilies(
      "Why is revenue down and why is Spa weak and where should we add equipment?",
    );
    const positions = routed.map((family) =>
      REPORT_FAMILY_REASONING_ORDER.indexOf(family),
    );
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("never repeats a family, however many rules fire", () => {
    const routed = routeReportFamilies(
      "spa conversion spa beds spa equipment spa sessions why is spa weak add spa",
    );
    expect(new Set(routed).size).toBe(routed.length);
  });

  it("reads the question only, never the history", () => {
    // Structural rather than a convention: there is no parameter a previous
    // turn could arrive through.
    expect(routeReportFamilies.length).toBe(1);
  });

  it("is case insensitive", () => {
    expect(routeReportFamilies("WHY IS SPA WEAK")).toContain("spa-engagement");
    expect(routeReportFamilies("Why Is Spa Weak")).toContain("spa-engagement");
  });
});

describe("every term and intent is safe to compile into a pattern", () => {
  it("holds no term that could match everything", () => {
    // A regex metacharacter added unescaped would silently turn the routing
    // always-true, which is the one way this module could fail invisibly.
    for (const family of REPORT_FAMILY_IDS) {
      for (const term of FAMILY_QUESTION_TERMS[family]) {
        expect(term, `${family}: ${term}`).toMatch(/^[a-z0-9 -]+$/);
        expect(term.length, `${family}: ${term}`).toBeGreaterThan(2);
      }
    }
    for (const intent of REPORT_QUESTION_INTENTS) {
      for (const term of intent.terms) {
        expect(term, `${intent.id}: ${term}`).toMatch(/^[a-z0-9 '-]+$/);
      }
    }
  });

  it("gives every intent a purpose and at least one family", () => {
    for (const intent of REPORT_QUESTION_INTENTS) {
      expect(intent.purpose.length, intent.id).toBeGreaterThan(20);
      expect(intent.families.length, intent.id).toBeGreaterThan(0);
      for (const family of intent.families) {
        expect(REPORT_FAMILY_IDS).toContain(family);
      }
    }
  });

  it("names the intents a question matched, for a reviewer", () => {
    expect(matchedIntents("What should I focus on today?").map((i) => i.id)).toContain(
      "daily_focus",
    );
    expect(matchedIntents("Why is Spa weak?").map((i) => i.id)).toContain("spa_weak");
    expect(matchedIntents("What is the dress code?")).toEqual([]);
  });
});

describe("the bed and spa gate is unchanged by the move", () => {
  /*
   * `question-gate.ts` used to own a flat list covering three families; it now
   * derives its list from those three families' vocabularies. The move must be
   * behaviour-preserving, and these are the properties that prove it.
   */
  it("derives its vocabulary from exactly the three bed and spa families", () => {
    const union = new Set([
      ...FAMILY_QUESTION_TERMS["bed-usage"],
      ...FAMILY_QUESTION_TERMS["spa-wellness"],
      ...FAMILY_QUESTION_TERMS["spa-engagement"],
    ]);
    expect(new Set(REPORTING_QUESTION_TERMS)).toEqual(union);
  });

  it("carries no Sales Totals or Salon Performance term", () => {
    // The two new vocabularies are wider — "today", "revenue", "compare" — and
    // leaking them into this gate would attach the bed and spa briefing to
    // every daily question, which is a different report's figures.
    for (const term of ["today", "revenue", "compare", "mtd", "otc"]) {
      expect(REPORTING_QUESTION_TERMS).not.toContain(term);
    }
  });

  it("still opens for a bed or spa question and still closes for a policy one", () => {
    expect(isReportingQuestion("Which salons have the lowest spa conversion?")).toBe(true);
    expect(isReportingQuestion("Are we outperforming the chain on per bed usage?")).toBe(true);
    expect(isReportingQuestion("What is the refund policy on memberships?")).toBe(false);
    expect(isReportingQuestion("What is the dress code?")).toBe(false);
  });
});

describe("the family registry", () => {
  it("accepts only the five families, from anything untrusted", () => {
    expect(parseReportFamily("bed-usage")).toBe("bed-usage");
    expect(parseReportFamily(" Spa-Wellness ")).toBe("spa-wellness");
    expect(parseReportFamily("bonus-viewer")).toBeNull();
    expect(parseReportFamily("sales_totals")).toBeNull();
    expect(parseReportFamily("")).toBeNull();
    expect(parseReportFamily(null)).toBeNull();
    expect(parseReportFamily(42)).toBeNull();
    expect(parseReportFamily({ family: "bed-usage" })).toBeNull();
  });

  it("has no sixth family, because the report-to-dashboard mapping is fixed", () => {
    expect(REPORT_FAMILY_IDS).toHaveLength(5);
    expect(REPORT_FAMILY_REASONING_ORDER).toHaveLength(5);
    expect(new Set(REPORT_FAMILY_REASONING_ORDER)).toEqual(new Set(REPORT_FAMILY_IDS));
  });

  it("orders and de-duplicates whatever order families arrive in", () => {
    expect(orderReportFamilies(["spa-engagement", "sales-totals", "spa-engagement"])).toEqual([
      "sales-totals",
      "spa-engagement",
    ]);
    expect(orderReportFamilies([])).toEqual([]);
  });
});
