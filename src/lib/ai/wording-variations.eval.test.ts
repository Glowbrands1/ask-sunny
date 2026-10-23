import { describe, expect, it } from "vitest";

import { detectInventoryQuestion } from "@/lib/forms/inventory-question";
import { detectTemplateIntent } from "@/lib/forms/template-intent";
import { sectionTitleMatches } from "@/lib/knowledge/hybrid-rank";

import { expandGlossaryQuery, glossaryIntent, matchGlossary } from "./glossary";
import { normalizeUserMessage } from "./message-normalize";

/**
 * Varied manager wording. Baseline is the existing phrase list and section
 * matcher. Flags-on is the glossary expansion plus a schema-valid normalize
 * result. Haiku is not called.
 */

const PHRASES: { readonly text: string; readonly section?: string }[] = [
  { text: "do the paperwork" },
  { text: "ya just do the paperwork" },
  { text: "pls make the ca na" },
  { text: "can u do paperwork alr" },
  { text: "writeup for her pls" },
  { text: "need the dpoa asap" },
  { text: "go ahead and file it" },
  { text: "yep do that write-up" },
  { text: "paperwork for the late open", section: "Late Opening" },
  { text: "can u do the CA already" },
  { text: "ok make the writeup" },
  { text: "rit her up? nvm do the ca" },
  { text: "wat is the fone policy" },
  { text: "cellfone on the floor during a tan" },
  { text: "she keep checking her smartwatch" },
  { text: "late open policy pls", section: "Late Opening" },
  { text: "she was tardy again what section" },
  { text: "no call no show what do we cite" },
  { text: "dresscode violation which page" },
  { text: "standards of conduct or the phone one", section: "Standards of Conduct" },
  { text: "visitors at work policy page?" },
  { text: "the seminar she missed" },
  { text: "the cell one" },
  { text: "pls whats the rule for celphone" },
  { text: "attendance vs late opening which one", section: "Late Opening" },
  { text: "boss she always late open na, ano policy", section: "Late Opening" },
  { text: "need u to explain the smart watch thing real quick", section: "Cell Phone/Smart Watch Policy" },
  { text: "stc exit paperwork she quit" },
  { text: "can we do a coaching form for the no show" },
  {
    text: "hey sorry this is long but jordan was on her fone again in the back room and i already talked to her so can u just tell me which policy that is",
  },
  {
    text: "ok so like she was supposed to open and she didnt and then she showed up late and i dont want a lecture i just need the late open section",
    section: "Late Opening",
  },
  { text: "whats a ca" },
];

function baselineDestination(question: string): "form" | "search" {
  if (detectInventoryQuestion(question).kind !== "none") return "form";
  const intent = detectTemplateIntent(question);
  if (intent.kind === "none" || intent.kind === "clarify") return "search";
  if (intent.kind === "corrective_action" && !intent.requestedCreation) return "search";
  return "form";
}

function flagsOnDestination(question: string): "form" | "search" {
  const expanded = expandGlossaryQuery(question);
  if (glossaryIntent(question) === "form") return "form";
  return baselineDestination(expanded);
}

describe("wording variations", () => {
  const rows = PHRASES.map((phrase) => ({
    phrase: phrase.text,
    baseline: baselineDestination(phrase.text),
    flagsOn: flagsOnDestination(phrase.text),
    section: phrase.section ?? null,
    sectionBaseline: phrase.section ? sectionTitleMatches(phrase.text, phrase.section) : null,
    sectionOn: phrase.section ? sectionTitleMatches(expandGlossaryQuery(phrase.text), phrase.section) : null,
  }));

  it("covers at least 30 phrasings and moves missed form commands onto the form path", () => {
    expect(rows.length).toBeGreaterThanOrEqual(30);
    const moved = rows.filter((row) => row.baseline === "search" && row.flagsOn === "form");
    expect(moved.length).toBeGreaterThan(0);
    expect(rows.find((row) => row.phrase === "do the paperwork")?.flagsOn).toBe("form");
    expect(rows.find((row) => row.phrase === "whats a ca")?.flagsOn).toBe("search");
  });

  it("names a section only when the question's own words name it", () => {
    const policies = rows.filter((row) => row.section);
    expect(policies.length).toBeGreaterThan(0);
    for (const row of policies) {
      expect(row.sectionBaseline, row.phrase).toBe(true);
      expect(row.sectionOn, row.phrase).toBe(true);
    }
    const shorthand = ["wat is the fone policy", "cellfone on the floor during a tan", "she was tardy again what section", "the cell one"];
    for (const phrase of shorthand) {
      expect(expandGlossaryQuery(phrase), phrase).toBe(phrase);
    }
  });

  it("does not read ca inside an ordinary word, and keeps the original text", () => {
    expect(matchGlossary("can you cancel the order").some((hit) => hit.term.term === "ca")).toBe(false);
    expect(matchGlossary("no call no show")).toEqual([]);
    const expanded = expandGlossaryQuery("do the paperwork");
    expect(expanded.startsWith("do the paperwork")).toBe(true);
    expect(expanded).toContain("corrective action form");
  });

  it("falls back to the original on timeout or a failed model call", async () => {
    const timedOut = await normalizeUserMessage(
      {
        question: "hello there friend",
        history: [],
        timeoutMs: 20,
        callModel: () => new Promise(() => undefined),
      },
    );
    expect(timedOut.answerText).toBe("hello there friend");
    expect(timedOut.modelQuery).toBeNull();
    expect(timedOut.routingText).toBe("hello there friend");

    const failed = await normalizeUserMessage({
      question: "do the paperwork",
      history: [],
      callModel: async () => {
        throw new Error("model down");
      },
    });
    expect(failed.answerText).toBe("do the paperwork");
    expect(failed.routingText).toContain("corrective action form");
    expect(failed.intent).toBe("form");
  });

  it("uses a schema-valid model query and still answers with the original words", async () => {
    const normalized = await normalizeUserMessage({
      question: "the cell one",
      history: [{ role: "user", content: "What does the manual say about a cell phone on the floor?" }],
      callModel: async () => ({ query: "Cell Phone/Smart Watch Policy", intent: "policy_question" }),
    });
    expect(normalized.answerText).toBe("the cell one");
    expect(normalized.modelQuery).toBe("Cell Phone/Smart Watch Policy");
    expect(normalized.intent).toBe("policy");
  });
});
