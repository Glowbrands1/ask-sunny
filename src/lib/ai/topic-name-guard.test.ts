import { afterEach, describe, expect, it } from "vitest";

import { extractEmployeeNames } from "@/lib/forms/proposal";
import type { ChatFormProposal } from "@/types";

import { guardTopicName, withTopicNotAName } from "./topic-name-guard";
import type { AskRequest, AskResponse } from "./types";

/**
 * QA, 25-26 Oct 2026 (Sunny batch 12, Bubbles B2): the managers' turns exactly.
 * Main's reader takes "efts spa", "efts" and "weekly" as names (pinned below).
 */
const FLAG = "TOPIC_NOT_A_NAME_ENABLED";
const saved = process.env[FLAG];
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

function card(employeeName: string | null, extra: Partial<ChatFormProposal> = {}): ChatFormProposal {
  return {
    proposalId: "p",
    supportsInlineDraft: true,
    templateKey: "coaching",
    templateName: "Coaching Form",
    variantKey: null,
    employeeName,
    employeeRole: null,
    locationId: null,
    locationName: null,
    locationResolution: "not_applicable",
    authorizedLocationIds: [],
    status: "ready",
    sourceMessageIds: [],
    ...extra,
  };
}

function respond(name: string, extra: Partial<ChatFormProposal> = {}): AskResponse {
  return { content: `Here is what I would put on a **Coaching Form** for **${name}**.`, citations: [], formProposal: card(name, extra) } as unknown as AskResponse;
}

describe("TOPIC_NOT_A_NAME_ENABLED off", () => {
  it("keeps the topic as the employee, as main does", () => {
    delete process.env[FLAG];
    expect(extractEmployeeNames("coaching form efts spa")).toEqual(["efts spa"]);
    expect(extractEmployeeNames("weekly")).toEqual(["weekly"]);
    const response = respond("efts spa");
    expect(withTopicNotAName(response, { question: "coaching form efts spa", history: [] } as unknown as AskRequest)).toBe(response);
  });
});

describe("TOPIC_NOT_A_NAME_ENABLED on", () => {
  it.each([
    ["coaching form efts spa", "efts spa"],
    ["Coaching form efts spa", "efts spa"],
    ["coaching for efts", "efts"],
    ["Coaching for EFTs", "EFTs"],
    ["weekly", "weekly"],
    ["Weekly", "Weekly"],
  ])("'%s' leaves Employee blank and asks who", (turn, name) => {
    process.env[FLAG] = "on";
    const out = withTopicNotAName(respond(name), { question: turn, history: [] } as unknown as AskRequest);
    expect(out.formProposal?.employeeName).toBeNull();
    expect(out.formProposal?.status).toBe("needs_employee");
    expect(out.content).toContain("Who is this form for — one employee, or the whole team?");
  });

  it.each([
    "can u creat a coachng form for efts and the spa for my team",
    "Can u creat a coachng form for efts and the spa for my team",
  ])("'%s' is a team coaching form", (turn) => {
    process.env[FLAG] = "on";
    const out = withTopicNotAName(respond("efts"), { question: turn, history: [] } as unknown as AskRequest);
    expect(out.formProposal?.subject).toBe("team");
    expect(out.formProposal?.employeeName).toBe("All team members");
    expect(out.formProposal?.supportsInlineDraft).toBe(true);
  });

  it("reads 'I already told you for the whole team' from a later turn", () => {
    process.env[FLAG] = "on";
    const out = guardTopicName(respond("weekly"), ["coaching for efts", "weekly", "just make it", "I already told you for the whole team"]);
    expect(out.formProposal?.subject).toBe("team");
  });

  it("keeps real names, names that are also words, and a team card", () => {
    process.env[FLAG] = "on";
    for (const name of ["Avery Stone", "Lisa", "Joy Summer", "Will Hope", "Rose"]) {
      const response = respond(name);
      expect(guardTopicName(response, ["coaching for " + name])).toBe(response);
    }
    const team = respond("All team members", { subject: "team" });
    expect(guardTopicName(team, ["coaching for the whole team"])).toBe(team);
  });

  it("never makes a corrective action a team form", () => {
    process.env[FLAG] = "on";
    const response = { ...respond("efts"), formProposal: card("efts", { templateKey: "dpoa", templateName: "Corrective Action Form" }) } as AskResponse;
    const out = guardTopicName(response, ["ca for efts for my team"]);
    expect(out.formProposal?.subject).toBeUndefined();
    expect(out.formProposal?.employeeName).toBeNull();
  });
});

/** The same QA turns in lowercase, sentence case and capitals. */
describe("TOPIC_NOT_A_NAME_ENABLED on: lowercase, sentence case and capitals", () => {
  const twins = (text: string) => {
    const lower = text.toLowerCase();
    return [lower, lower[0]!.toUpperCase() + lower.slice(1), text.toUpperCase()];
  };

  it.each([...twins("coaching form efts spa"), ...twins("coaching for efts"), ...twins("weekly")])("'%s' leaves Employee blank and asks who", (turn) => {
    process.env[FLAG] = "on";
    const name = turn.replace(/^coaching (?:form|for) /i, "");
    const out = withTopicNotAName(respond(name), { question: turn, history: [] } as unknown as AskRequest);
    expect(out.formProposal?.employeeName).toBeNull();
    expect(out.content).toContain("Who is this form for — one employee, or the whole team?");
  });

  it.each([...twins("can u creat a coachng form for efts and the spa for my team"), ...twins("I already told you for the whole team")])("'%s' is a team coaching form", (turn) => {
    process.env[FLAG] = "on";
    const out = guardTopicName(respond("efts"), ["coaching for efts", turn]);
    expect(out.formProposal?.subject).toBe("team");
  });

  it.each(twins("coaching for avery stone"))("'%s' keeps the person", (turn) => {
    process.env[FLAG] = "on";
    const response = respond(turn.replace(/^coaching for /i, ""));
    expect(guardTopicName(response, [turn])).toBe(response);
  });
});

/** QA-2 negation probes, 26 Oct 2026: a negated team phrase is never the team card. */
describe("TOPIC_NOT_A_NAME_ENABLED on: 'not for my team' is not the team", () => {
  const twins = (text: string) => [text.toLowerCase(), text[0]!.toUpperCase() + text.slice(1).toLowerCase(), text.toUpperCase()];

  it.each([
    ...twins("coaching form efts, not for my team"),
    ...twins("coaching for efts, it is not for the whole team"),
    ...twins("coaching for efts. don't make it for the whole team"),
  ])("'%s' leaves Employee blank and asks who", (turn) => {
    process.env[FLAG] = "on";
    const out = guardTopicName(respond("efts"), [turn]);
    expect(out.formProposal?.subject).not.toBe("team");
    expect(out.formProposal?.employeeName).toBeNull();
  });

  it.each(twins("no, not for my team, just for efts"))("a later '%s' undoes an earlier 'for my team'", (later) => {
    process.env[FLAG] = "on";
    const out = guardTopicName(respond("efts"), ["coaching for efts for my team", later]);
    expect(out.formProposal?.subject).not.toBe("team");
  });

  it("a later 'for the whole team' after a negation is the team", () => {
    process.env[FLAG] = "on";
    expect(guardTopicName(respond("efts"), ["coaching form efts, not for my team", "actually yes, for the whole team"]).formProposal?.subject).toBe("team");
  });
});

describe("TOPIC_NOT_A_NAME_ENABLED on: a real name is kept in any case", () => {
  it.each(["coaching for mara quill", "Coaching for Mara Quill", "COACHING FOR MARA QUILL"])("'%s' keeps the person", (turn) => {
    process.env[FLAG] = "on";
    const response = respond(turn.replace(/^coaching for /i, ""));
    expect(guardTopicName(response, [turn])).toBe(response);
  });
});
