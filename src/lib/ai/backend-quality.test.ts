import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  citationVerifyEnabled,
  modelRetryEnabled,
  promptCacheEnabled,
  requiredFieldCheckEnabled,
} from "@/lib/config/chat-quality-flags";
import { CLAUDE_MODEL } from "@/lib/config/models";
import type { ChatFormProposal, SourceCitation } from "@/types";

import { JBA_MANUAL_CHUNKS } from "./__fixtures__/jba-policy-manual";
import {
  dropUnverifiedManualLines,
  headingAndPageInManual,
  keepCurrentManualCitations,
} from "./citation-verify";
import { openChatTrace } from "./chat-trace";
import { chatTraceDraft, runChatTrace, updateChatTrace } from "./chat-trace-store";
import { MODEL_BUSY_MESSAGE, MODEL_MAX_RETRIES, MODEL_TIMEOUT_MS, modelRequestOptions, modelUnavailable } from "./model-retry";
import {
  cachedSystem,
  cachedUserContent,
  firstTokenLatencyMs,
  groundingWithoutCachedManual,
  promptCacheCalls,
} from "./prompt-cache";
import { missingRequiredFields, withRequiredFieldList } from "./required-field-check";
import { noteTraceOutcome, traceIntent } from "./trace-outcome";
import type { AskResponse } from "./types";

const SAVED = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in SAVED)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(SAVED)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function proposal(partial: Partial<ChatFormProposal>): ChatFormProposal {
  return {
    proposalId: "prop-1",
    templateKey: "dpoa",
    templateName: "Corrective Action Form",
    supportsInlineDraft: true,
    variantKey: null,
    employeeName: "Test Employee",
    employeeRole: "Team Member",
    formDate: "2026-10-15",
    payrollDeduct: "no",
    warningLevel: "written",
    locationId: "loc-1",
    locationName: "MO Wornall",
    locationResolution: "resolved",
    authorizedLocationIds: ["loc-1"],
    status: "ready",
    sourceMessageIds: [],
    ...partial,
  };
}

function answer(content: string, formProposal?: ChatFormProposal): AskResponse {
  return {
    content,
    citations: [],
    coverage: "grounded",
    recommendedVideoIds: [],
    ...(formProposal ? { formProposal } : {}),
  };
}

describe("prompt caching stays off the request until PROMPT_CACHE_ENABLED", () => {
  it("sends the system prompt as a string and leaves the manual inside the grounding", () => {
    delete process.env.PROMPT_CACHE_ENABLED;
    expect(promptCacheEnabled()).toBe(false);
    const grounding = "EVIDENCE\n\nPOLICY FROM THE JBA POLICY MANUAL\n\nAttendance";
    expect(cachedSystem("You are Sunny.")).toBe("You are Sunny.");
    expect(groundingWithoutCachedManual(grounding, "POLICY FROM THE JBA POLICY MANUAL\n\nAttendance")).toBe(grounding);
    expect(cachedUserContent("question", "POLICY FROM THE JBA POLICY MANUAL\n\nAttendance")).toBe("question");
  });

  it("puts cache_control on the system prompt and the manual block", () => {
    process.env.PROMPT_CACHE_ENABLED = "on";
    const manual = "POLICY FROM THE JBA POLICY MANUAL\n\nAttendance, page 14";
    const grounding = `EVIDENCE\n\n${manual}`;
    expect(cachedSystem("You are Sunny.")).toEqual([
      { type: "text", text: "You are Sunny.", cache_control: { type: "ephemeral" } },
    ]);
    expect(groundingWithoutCachedManual(grounding, manual)).toBe("EVIDENCE");
    expect(cachedUserContent("QUESTION\n\nlate", manual)).toEqual([
      { type: "text", text: manual, cache_control: { type: "ephemeral" } },
      { type: "text", text: "QUESTION\n\nlate" },
    ]);
  });

  it("puts cache_control on the static block and leaves the dynamic tail uncached", () => {
    process.env.PROMPT_CACHE_ENABLED = "on";
    const system = "You are Sunny.\n\n---DYNAMIC---\n\nYou are talking to Dana Reyes, who runs MO Wornall. Today is 2026-10-24.";
    expect(cachedSystem(system)).toEqual([
      { type: "text", text: "You are Sunny.", cache_control: { type: "ephemeral" } },
      {
        type: "text",
        text: "---DYNAMIC---\n\nYou are talking to Dana Reyes, who runs MO Wornall. Today is 2026-10-24.",
      },
    ]);
    const calls = promptCacheCalls([system, system]);
    expect(calls[0]?.cache_creation_input_tokens).toBeGreaterThan(0);
    expect(calls[0]?.cache_read_input_tokens).toBe(0);
    expect(calls[1]?.cache_creation_input_tokens).toBe(0);
    expect(calls[1]?.cache_read_input_tokens).toBeGreaterThan(0);
    // The cached prefix is everything before the marker. Repeating the whole
    // prompt leaves that prefix one line long and puts the rest in the tail,
    // so the two scans are the same size and the clock can go either way.
    const latency = firstTokenLatencyMs(
      `${"You are Sunny.\n".repeat(40)}---DYNAMIC---\n\nYou are talking to Dana Reyes, who runs MO Wornall. Today is 2026-10-24.`,
    );
    expect(latency.newMs).toBeLessThan(latency.oldMs);
  });
});

describe("model timeout and overloaded fallback stay behind MODEL_RETRY_ENABLED", () => {
  it("omits request options and keeps the existing failure text", () => {
    delete process.env.MODEL_RETRY_ENABLED;
    expect(modelRetryEnabled()).toBe(false);
    expect(modelRequestOptions()).toBeUndefined();
    const error = modelUnavailable({ status: 529 });
    expect(error.message).toBe("Sunny could not reach the language model. No answer was generated.");
    expect(error.status).toBe(502);
  });

  it("uses a 45 second timeout, two retries, and a plain message on 529", () => {
    process.env.MODEL_RETRY_ENABLED = "on";
    expect(MODEL_TIMEOUT_MS).toBe(45_000);
    expect(MODEL_MAX_RETRIES).toBe(2);
    expect(modelRequestOptions()).toEqual({ timeout: 45_000, maxRetries: 2 });
    const busy = modelUnavailable({ status: 529 });
    expect(busy.message).toBe(MODEL_BUSY_MESSAGE);
    expect(busy.status).toBe(503);
    expect(modelUnavailable({ error: { type: "overloaded_error" } }).message).toBe(MODEL_BUSY_MESSAGE);
    expect(modelUnavailable({ status: 500 }).message).toBe(
      "Sunny could not reach the language model. No answer was generated.",
    );
  });
});

describe("required fields are listed from the template, and a typed name counts", () => {
  it("does not treat a name that is not in Woven as missing", () => {
    delete process.env.REQUIRED_FIELD_CHECK_ENABLED;
    expect(requiredFieldCheckEnabled()).toBe(false);
    const card = proposal({ employeeName: "Test Employee" });
    expect(missingRequiredFields(card).map((item) => item.key)).not.toContain("employee_name");
    const listed = withRequiredFieldList(answer("I'll draft it.", card));
    expect(listed.content).not.toMatch(/woven|roster|not found/i);
    expect(listed.content).not.toContain("Employee Name");
    expect(listed.content).not.toContain("Still needed");
  });

  it("names the template fields the proposal has not filled", () => {
    const card = proposal({
      employeeRole: null,
      locationId: null,
      locationName: null,
      locationResolution: "needs_selection",
      payrollDeduct: null,
      awaitingIncident: true,
    });
    expect(missingRequiredFields(card).map((item) => item.label)).toEqual([
      "Job Title",
      "Location",
      "Is payroll deduct applicable?",
      "Observation of Offense",
    ]);
    const listed = withRequiredFieldList(answer("I'll draft a form for **Test Employee**.", card));
    expect(listed.content).toContain("Still needed: Job Title, Location, Is payroll deduct applicable?, Observation of Offense.");
    expect(listed.content).not.toMatch(/woven|roster/i);
    expect(listed.content).toContain("Test Employee");
  });
});

describe("citations that are not in the current manual are dropped", () => {
  it("keeps Attendance page 14 and drops a heading the manual does not have", () => {
    delete process.env.CITATION_VERIFY_ENABLED;
    expect(citationVerifyEnabled()).toBe(false);
    expect(headingAndPageInManual("Attendance", 14, JBA_MANUAL_CHUNKS)).toBe(true);
    expect(headingAndPageInManual("Attendance", 99, JBA_MANUAL_CHUNKS)).toBe(false);
    const content = dropUnverifiedManualLines(
      "See Attendance, JBA Policy Manual p.14.\n\nAlso Unicorn Policy, JBA Policy Manual p.4.",
      JBA_MANUAL_CHUNKS,
    );
    expect(content).toContain("Attendance, JBA Policy Manual p.14");
    expect(content).not.toContain("Unicorn");
  });

  it("drops a manual source card whose page is not the current chunk", () => {
    const real: SourceCitation = {
      documentId: "manual",
      documentTitle: "JBA Policy Manual",
      locator: "Page 14",
      category: "policies_compliance",
      excerpt: "Attendance. Be on time.",
      relevance: 1,
    };
    const invented: SourceCitation = {
      documentId: "manual",
      documentTitle: "JBA Policy Manual",
      locator: "Page 99",
      category: "policies_compliance",
      excerpt: "Unicorn Policy. Invented.",
      relevance: 1,
    };
    const other: SourceCitation = {
      documentId: "guide",
      documentTitle: "Salon Coaching Guide",
      locator: "Page 3",
      category: "training",
      excerpt: "Open the store.",
      relevance: 1,
    };
    expect(keepCurrentManualCitations([real, invented, other], JBA_MANUAL_CHUNKS)).toEqual([real, other]);
  });
});

describe("chat traces mark no-card and low-retrieval turns", () => {
  it("tags a search that returned one chunk and no card", async () => {
    const draft = openChatTrace({
      originalQuery: "what is the dress code",
      formInProgress: false,
    });
    await runChatTrace(draft, async () => {
      updateChatTrace({ intent: "search", retrievalCount: 1 });
      noteTraceOutcome({});
      expect(chatTraceDraft()?.intent).toBe("search|no_card|low_retrieval");
    });
  });

  it("tags a form card without calling retrieval low", () => {
    expect(traceIntent("form", { noCard: false, lowRetrieval: false })).toBe("form|card");
  });
});

describe("the answering model stays Opus", () => {
  it("defaults to claude-opus-5", () => {
    const source = readFileSync("src/lib/config/models.ts", "utf8");
    expect(source).toContain('process.env.ANTHROPIC_MODEL || "claude-opus-5"');
    expect(CLAUDE_MODEL === "claude-opus-5" || process.env.ANTHROPIC_MODEL === CLAUDE_MODEL).toBe(true);
    const caller = readFileSync("src/lib/ai/call-claude.ts", "utf8");
    expect(caller).toContain("model: CLAUDE_MODEL");
    expect(caller).not.toContain("claude-sonnet");
  });
});
