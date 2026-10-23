import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { correctiveActionDocument } from "@/lib/forms/library";
import { detectInventoryQuestion } from "@/lib/forms/inventory-question";
import { detectTemplateIntent } from "@/lib/forms/template-intent";
import type { AccessScope } from "@/types";
import type { MatchedChunkRow } from "@/lib/knowledge/mappers";

import { buildSystemPrompt } from "./prompts";
import {
  chatStyleRulesEnabled,
  formToolsEnabled,
  hybridSearchEnabled,
  queryRewriteEnabled,
} from "@/lib/config/chat-quality-flags";
import {
  confirmedFromToolTurn,
  EMPTY_CONFIRMED_FIELDS,
  missingIntakeItems,
  retentionReply,
} from "./form-field-state";
import { parseFormToolTurn, FORM_TOOL_INPUT_SCHEMA, type FormToolTurn } from "./form-tool-schema";
import { formCommandBypassesSearch, routeUnderstoodFormTurn } from "./form-tool-route";
import { understandFormTurn } from "./form-tool-understand";
import { queryAfterRewrite, shouldRewriteFollowUp } from "./query-rewrite";
import { retrievalQueryFor } from "./retrieval-query";
import { sectionTitleMatches, selectHybridMatches, type HybridCandidate } from "@/lib/knowledge/hybrid-rank";

/**
 * Low-star failures, anonymized. Baseline is the phrase list and vector-only
 * rank. Flags-on is the tool reading, the field validators, and hybrid rank.
 * Haiku is not called here: the tool payload is the contract the model must
 * return, parsed by the same schema production uses.
 */

vi.mock("@/lib/forms/repository", () => ({
  listTemplateSummaries: async () => {
    throw new Error("the proposal takes the library from its caller");
  },
  getTemplateByKey: async () => {
    throw new Error("the proposal must not read the library");
  },
}));

const TODAY = "2026-10-23";
const DETAILS =
  "Jordan Lee is a team member at Wornall. Use today's date. She opened the salon late.";

const COMMANDS = [
  "create the ca",
  "go ahead",
  "yes",
  "do the paperwork",
  "write her up",
  "yeah just do the write up",
  "can u do the CA already",
  "ok make it",
  "yep",
  "paperwork for the late open",
] as const;

function baselineDestination(question: string): "form" | "search" {
  const inventory = detectInventoryQuestion(question);
  if (inventory.kind !== "none") return "form";
  const intent = detectTemplateIntent(question);
  if (intent.kind === "none" || intent.kind === "clarify") return "search";
  if (intent.kind === "corrective_action" && !intent.requestedCreation) return "search";
  return "form";
}

function toolFor(phrase: string): FormToolTurn {
  const parsed = parseFormToolTurn({
    intent: /^(?:yes|yep|go ahead|ok make it)$/i.test(phrase) ? "confirm" : "form_command",
    templateKey: "dpoa",
    confirmsOpenForm: true,
    fields: {
      employeeName: "Jordan Lee",
      jobTitle: "team member",
      salon: "Wornall",
      incidentDateIso: null,
      useToday: true,
      payrollDeduct: null,
      payrollAmount: null,
      warningLevel: null,
      policySection: null,
      deadline: null,
    },
  });
  if (!parsed) throw new Error(`schema rejected the fixture for ${phrase}`);
  return parsed;
}

function chunk(
  id: string,
  section: string,
  page: number,
  similarity: number,
  content: string,
): MatchedChunkRow {
  return {
    chunk_id: id,
    document_id: "manual",
    document_title: "JBA Policy Manual",
    category: "policies",
    locator: `Page ${page} — ${section}`,
    page,
    section,
    content,
    similarity,
  };
}

function vectorOnly(rows: MatchedChunkRow[], floor = 0.78): MatchedChunkRow | null {
  return [...rows].filter((row) => row.similarity >= floor).sort((a, b) => b.similarity - a.similarity)[0] ?? null;
}

function hybrid(query: string, rows: HybridCandidate[]): MatchedChunkRow | null {
  return selectHybridMatches(rows, query, { vectorFloor: 0.78, limit: 4 })[0] ?? null;
}

const PROMPT_CONTEXT = {
  userName: "Dana Reyes",
  locationName: "MO Kansas City Wornall",
  todayIso: TODAY,
};

describe("flags default off", () => {
  it("treats unset and negative values as off", () => {
    const previous = {
      FORM_TOOLS_ENABLED: process.env.FORM_TOOLS_ENABLED,
      HYBRID_SEARCH_ENABLED: process.env.HYBRID_SEARCH_ENABLED,
      QUERY_REWRITE_ENABLED: process.env.QUERY_REWRITE_ENABLED,
      CHAT_STYLE_RULES_ENABLED: process.env.CHAT_STYLE_RULES_ENABLED,
    };
    delete process.env.FORM_TOOLS_ENABLED;
    delete process.env.HYBRID_SEARCH_ENABLED;
    delete process.env.QUERY_REWRITE_ENABLED;
    delete process.env.CHAT_STYLE_RULES_ENABLED;
    expect(formToolsEnabled()).toBe(false);
    expect(hybridSearchEnabled()).toBe(false);
    expect(queryRewriteEnabled()).toBe(false);
    expect(chatStyleRulesEnabled()).toBe(false);
    process.env.FORM_TOOLS_ENABLED = "off";
    expect(formToolsEnabled()).toBe(false);
    process.env.FORM_TOOLS_ENABLED = "true";
    expect(formToolsEnabled()).toBe(true);
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("leaves the system prompt unchanged until the style flag asks for the rules", () => {
    const shared = {
      assistantName: "Sunny",
      brandName: "Sun Tan City",
      salonNoun: "salon",
      context: PROMPT_CONTEXT,
      mode: "standard" as const,
      hasContext: true,
    };
    const off = buildSystemPrompt(shared);
    const explicitOff = buildSystemPrompt({ ...shared, styleRules: false });
    expect(explicitOff).toBe(off);
    expect(off).not.toContain("EMPLOYEE NAME, PAYROLL, AND THE CHOSEN ACTION");
    const on = buildSystemPrompt({ ...shared, styleRules: true });
    expect(on).toContain("use that name");
    expect(on).toContain("include that amount");
    expect(on).toContain("do not recommend coaching instead");
  });

  it("gates the new path in front of knowledge search", () => {
    const source = readFileSync("src/lib/ai/server-ask.ts", "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("process.env");
    expect(code).not.toContain(".catch(");
    expect(source.indexOf("proposeFormForTurn")).toBeLessThan(source.indexOf("knowledge.match({"));
    expect(source.indexOf("understandFormTurn")).toBeLessThan(source.indexOf("knowledge.match({"));
    expect(source).toContain("if (formToolsEnabled() && !formsTurn)");
    expect(source).toContain("if (routed) return routed.response;");
    expect(source).toContain("queryRewriteEnabled()");
    expect(source).toContain("hybridSearchEnabled()");
    expect(source).toContain("chatStyleRulesEnabled()");
  });
});

describe("intent: form commands versus knowledge search", () => {
  const rows = COMMANDS.map((phrase) => ({
    phrase,
    baseline: baselineDestination(phrase),
    flagsOn: formCommandBypassesSearch(toolFor(phrase)) ? ("form" as const) : ("search" as const),
  }));

  it("keeps a policy question on search when the tool says so", () => {
    const reading = parseFormToolTurn({
      intent: "policy_question",
      templateKey: null,
      confirmsOpenForm: false,
      fields: {},
    });
    expect(reading && formCommandBypassesSearch(reading)).toBe(false);
  });

  it("sends the missed commands to the form path once the tool reading is on", () => {
    const missed = rows.filter((row) => row.baseline === "search");
    expect(missed.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.flagsOn, row.phrase).toBe("form");
    }
    expect(missed.every((row) => row.flagsOn === "form")).toBe(true);
  });

  it("does not search when the understood turn is routed", async () => {
    let proposed = 0;
    const routed = await routeUnderstoodFormTurn({
      reading: toolFor("go ahead"),
      question: "go ahead",
      history: [{ role: "user", content: DETAILS }],
      today: TODAY,
      propose: async () => {
        proposed += 1;
        return {
          content: "Employee's full name\nNothing has been created yet.",
          citations: [],
          recommendedVideoIds: [],
          formProposal: undefined,
        };
      },
    });
    expect(proposed).toBe(1);
    expect(routed?.response.content).not.toMatch(/nothing has been created/i);
    expect(routed?.response.content.toLowerCase()).not.toContain("employee's full name");
    expect(routed?.response.citations).toEqual([]);
  });
});

describe("field retention across turns", () => {
  const turn1 = DETAILS;
  const turn2 = `${turn1}\nVerbal warning. Payroll deduction yes, $25.`;
  const reading1 = toolFor("do the paperwork");
  const after1 = confirmedFromToolTurn(EMPTY_CONFIRMED_FIELDS, reading1, turn1, TODAY);
  const after2 = confirmedFromToolTurn(
    after1,
    parseFormToolTurn({
      intent: "provide_fields",
      templateKey: "dpoa",
      confirmsOpenForm: false,
      fields: {
        employeeName: "Jordan Lee",
        jobTitle: "team member",
        salon: "Wornall",
        incidentDateIso: null,
        useToday: true,
        payrollDeduct: "yes",
        payrollAmount: "$25",
        warningLevel: "verbal",
        policySection: "Late Opening",
        deadline: null,
      },
    })!,
    turn2,
    TODAY,
  );
  const invented = confirmedFromToolTurn(
    after2,
    parseFormToolTurn({
      intent: "correct_fields",
      templateKey: "dpoa",
      confirmsOpenForm: false,
      fields: {
        employeeName: "MO Kansas City Wornall",
        jobTitle: "team member",
        salon: "Wornall",
        incidentDateIso: "2019-01-01",
        useToday: false,
        payrollDeduct: "yes",
        payrollAmount: "$999",
        warningLevel: "written",
        policySection: "Late Opening",
        deadline: "next Friday",
      },
    })!,
    turn2,
    TODAY,
  );

  it("keeps the name, title, salon, and today's date, and does not ask for them again", () => {
    expect(after1.employeeName).toBe("Jordan Lee");
    expect(after1.jobTitle).toBe("team member");
    expect(after1.salon).toBe("MO Kansas City Wornall");
    expect(after1.useToday).toBe(true);
    expect(after1.incidentDateIso).toBe(TODAY);
    const missing = missingIntakeItems(turn1, after1).map((item) => item.key);
    expect(missing).not.toContain("employee_name");
    expect(missing).not.toContain("salon");
    expect(missing).not.toContain("form_date");
    expect(missing).not.toContain("job_title");
  });

  it("adds the warning and the stated deduction without dropping earlier fields", () => {
    expect(after2.employeeName).toBe("Jordan Lee");
    expect(after2.warningLevel).toBe("verbal");
    expect(after2.payrollDeduct).toBe("yes");
    expect(after2.payrollAmount).toBe("$25");
    expect(after2.policySection).toBe("Late Opening");
    const reply = retentionReply(after2, missingIntakeItems(turn2, after2));
    expect(reply).toContain("Jordan Lee");
    expect(reply).toContain("$25");
    expect(reply).not.toMatch(/nothing has been created/i);
    expect(reply.toLowerCase()).not.toContain("consider coaching");
  });

  it("rejects a salon placed in the name, an invented date, an invented amount, and an unstated deadline", () => {
    expect(invented.employeeName).toBe("Jordan Lee");
    expect(invented.incidentDateIso).toBe(TODAY);
    expect(invented.payrollAmount).toBe("$25");
    expect(invented.deadline).toBeNull();
    expect(invented.warningLevel).toBe("verbal");
  });
});

describe("policy section: vector-only versus hybrid", () => {
  const late = chunk("late", "Late Opening", 15, 0.8, "Late Opening. Synthetic policy wording.");
  const attendance = chunk("att", "Attendance", 14, 0.86, "Attendance. Synthetic policy wording.");
  const standards = chunk("soc", "Standards of Conduct", 12, 0.85, "Standards of Conduct. Synthetic policy wording.");
  const phone = chunk(
    "phone",
    "Cell Phone/Smart Watch Policy",
    19,
    0.79,
    "Cell Phone/Smart Watch Policy. Synthetic policy wording.",
  );
  const dress = chunk("dress", "Dress Code", 18, 0.7, "Dress Code. Uniform and name tag.");

  it("names Late Opening instead of Attendance", () => {
    const query = "she was late opening the salon what policy applies";
    const rows = [attendance, standards, late, phone];
    expect(vectorOnly(rows)?.section).toBe("Attendance");
    expect(sectionTitleMatches(query, "Late Opening")).toBe(true);
    expect(sectionTitleMatches(query, "Attendance")).toBe(false);
    const winner = hybrid(query, [
      { row: attendance, vectorRank: 1, keywordRank: null, sectionExact: false },
      { row: standards, vectorRank: 2, keywordRank: null, sectionExact: false },
      { row: late, vectorRank: 3, keywordRank: 1, sectionExact: false },
      { row: phone, vectorRank: 4, keywordRank: null, sectionExact: false },
    ]);
    expect(winner?.section).toBe("Late Opening");
  });

  it("names the cell phone policy instead of Standards of Conduct", () => {
    const query = "cell phone on the floor";
    const citedStandards = { ...standards, similarity: 0.88 };
    const citedAttendance = { ...attendance, similarity: 0.84 };
    expect(vectorOnly([citedStandards, citedAttendance, phone])?.section).toBe("Standards of Conduct");
    expect(sectionTitleMatches(query, "Cell Phone/Smart Watch Policy")).toBe(true);
    expect(sectionTitleMatches(query, "Standards of Conduct")).toBe(false);
    const winner = hybrid(query, [
      { row: citedStandards, vectorRank: 1, keywordRank: null, sectionExact: false },
      { row: citedAttendance, vectorRank: 2, keywordRank: null, sectionExact: false },
      { row: phone, vectorRank: 3, keywordRank: 1, sectionExact: false },
    ]);
    expect(winner?.section).toBe("Cell Phone/Smart Watch Policy");
  });

  it("returns a policy the vector floor would have called missing", () => {
    const query = "uniform name tag rules";
    expect(vectorOnly([dress])).toBeNull();
    const winner = hybrid(query, [
      { row: dress, vectorRank: null, keywordRank: 1, sectionExact: false },
    ]);
    expect(winner?.section).toBe("Dress Code");
  });
});

describe("short follow-ups are rewritten only when that flag's helper says so", () => {
  const history = [{ role: "user", content: "What does the manual say about a cell phone on the floor?" }];

  it("leaves 'the cell one' unexpanded on the regex path", () => {
    const question = "the cell one";
    expect(retrievalQueryFor({ question, history })).toBe(question);
    expect(shouldRewriteFollowUp(question, history)).toBe(true);
    expect(queryAfterRewrite(question, "cell phone smart watch policy")).toBe("cell phone smart watch policy");
    expect(queryAfterRewrite(question, "SKIP")).toBe(question);
  });
});

describe("the tool schema rejects a payload that is not a turn", () => {
  it("parses a partial tool call and drops an unknown intent", () => {
    expect(parseFormToolTurn({ intent: "confirm", confirmsOpenForm: true })).not.toBeNull();
    expect(parseFormToolTurn({ intent: "delete the database" })).toBeNull();
    expect(FORM_TOOL_INPUT_SCHEMA.properties.fields.required).toContain("payrollAmount");
    expect(FORM_TOOL_INPUT_SCHEMA.properties.fields.required).toContain("deadline");
  });

  it("returns null when the model call fails, instead of throwing into search", async () => {
    const failed = await understandFormTurn(
      { question: "go ahead", history: [], today: TODAY },
      async () => {
        throw new Error("model down");
      },
    );
    expect(failed).toBeNull();
    const parsed = await understandFormTurn(
      { question: "go ahead", history: [{ role: "user", content: DETAILS }], today: TODAY },
      async () => toolFor("go ahead"),
    );
    expect(parsed?.intent).toBe("confirm");
    expect(parsed?.templateKey).toBe("dpoa");
  });
});

describe("a missed command still reaches the existing proposal", () => {
  const SALON: AccessScope = { level: "salon", primaryAreaId: "loc-0306", alsoCoversAreaIds: [] };

  function template() {
    return {
      id: "tpl-dpoa",
      key: "dpoa",
      name: "Corrective Action Form",
      shortName: "Corrective Action Form",
      description: "Corrective Action Form",
      layoutFamily: "corrective",
      requiredPermission: "create_corrective_action",
      active: true,
      displayOrder: 1,
      currentVersion: {
        id: "v-dpoa",
        status: "published",
        document: correctiveActionDocument(),
        variants: [],
      },
      draftVersion: null,
      versionCount: 1,
      activeAsset: null,
      assetCount: 0,
    };
  }

  it("proposes from 'go ahead' after the details, without sending the turn to search", async () => {
    const { proposeFormForTurn } = await import("./form-proposal");
    const reading = toolFor("go ahead");
    expect(baselineDestination("go ahead")).toBe("search");
    const routed = await routeUnderstoodFormTurn({
      reading,
      question: "go ahead",
      history: [{ role: "user", content: DETAILS }],
      today: TODAY,
      propose: (adjusted) =>
        proposeFormForTurn({
          history: [{ id: "m1", role: "user", content: DETAILS }],
          question: adjusted.question,
          questionMessageId: "m2",
          actor: { role: "salon_director", scope: SALON },
          continueTemplateKey: adjusted.continueTemplateKey,
          summaries: [template()] as never,
          today: TODAY,
        }),
    });
    expect(routed).not.toBeNull();
    expect(routed!.response.formProposal?.templateKey).toBe("dpoa");
    expect(routed!.response.formProposal?.employeeName).toMatch(/Jordan Lee/i);
    expect(routed!.response.content).not.toMatch(/nothing has been created/i);
    expect(routed!.response.content.toLowerCase()).not.toContain("employee's full name");
    expect(routed!.fields.payrollAmount).toBeNull();
  });
});
