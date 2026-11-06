import { afterEach, describe, expect, it, vi } from "vitest";

import type { AskRequest } from "@/lib/ai/types";
import type { RosterEmployee } from "@/lib/forms/employee-match";

import {
  differentEmployeeReadConversation,
  readDifferentEmployee,
  withDifferentEmployee,
  withDifferentEmployeeSources,
} from "./different-employee-new-form";

/*
 * DIFFERENT_EMPLOYEE_NEW_FORM_ENABLED (QA live B21-4, 25 Oct 2026, #224;
 * rebuilt after the old-PR audit, 6 Nov 2026). QA's words: "now one for Test
 * Employee Two at Lawrence for being late on 10-20-26", said with Test
 * Employee's Corrective Action card on screen or created. "Test Employee" /
 * "Test Employee Two" are QA's placeholder names; every other person is
 * invented.
 */

const person = (id: string, firstName: string, lastName: string): RosterEmployee =>
  ({ id, firstName, lastName, preferredFirstName: null, locationIds: ["loc-264"] }) as unknown as RosterEmployee;

const PEOPLE = [
  person("te", "Test", "Employee"),
  person("te2", "Test", "Employee Two"),
  person("rory", "Rory", "Vance"),
  person("mara", "Mara", "Quell"),
];

const QA = "now one for Test Employee Two at Lawrence for being late on 10-20-26";
const cased = (s: string) => [s.toLowerCase(), s[0]!.toUpperCase() + s.slice(1), s.toUpperCase()];

afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("DIFFERENT_EMPLOYEE_NEW_FORM_ENABLED", "true");

describe("readDifferentEmployee", () => {
  it("off: reads nothing", () => {
    expect(readDifferentEmployee({ question: QA, employeeName: "Test Employee", people: PEOPLE })).toBeNull();
  });

  it.each([...cased(QA), ...cased("now one for Test Employee Two for being late on 10-20-26")])(
    '"%s" with Test Employee\'s card is Test Employee Two\'s own request — never "Test"',
    (question) => {
      on();
      expect(readDifferentEmployee({ question, employeeName: "Test Employee", people: PEOPLE })).toMatchObject({
        from: "Test Employee",
        to: "Test Employee Two",
      });
    },
  );

  it.each(cased("now one for Mara Quell for being late on 10-20-26"))('"%s" with Rory Vance\'s card is Mara Quell\'s', (question) => {
    on();
    expect(readDifferentEmployee({ question, employeeName: "Rory Vance", people: PEOPLE })).toMatchObject({ to: "Mara Quell" });
  });

  it.each([
    // The same person again.
    ["now one for Rory Vance again for being late on 10-20-26", "Rory Vance"],
    ["now one for Test Employee at Lawrence for being late on 10-22-26", "Test Employee"],
    // No account: SAME_FORM_OTHER_PERSON's, never this.
    ["Can you do the same thing for Mara Quell but switch it to a written", "Rory Vance"],
    ["now one for Mara Quell", "Rory Vance"],
    // An account that mentions a coworker: more of A's.
    ["she was rude to Mara Quell when she reminded her", "Rory Vance"],
    // Ruled out (QA-6 on #224).
    ["do not make one for Mara Quell, she was not late on 10-20-26", "Rory Vance"],
    ["never one for Mara Quell for being late on 10-20-26", "Rory Vance"],
    // Nobody on the roster.
    ["now one for Zelda Quinlan for being late on 10-20-26", "Rory Vance"],
  ])('"%s" (card: %s) is not another employee\'s request', (question, employeeName) => {
    on();
    expect(readDifferentEmployee({ question, employeeName, people: PEOPLE })).toBeNull();
  });
});

const history = [
  { id: "m1", role: "user", content: "I need a corrective action for Test Employee, she was late opening the salon on Monday" },
  {
    id: "a1",
    role: "assistant",
    content: "Here is what I would put on a Corrective Action Form.",
    formProposal: { templateKey: "dpoa", templateName: "Corrective Action Form", employeeName: "Test Employee", sourceMessageIds: ["m1"] },
  },
] as unknown as AskRequest["history"];

const request = (question: string, extra: Partial<AskRequest> = {}): AskRequest =>
  ({ question, history, questionMessageId: "m2", continueProposalTemplateKey: "dpoa", ...extra }) as unknown as AskRequest;

describe("withDifferentEmployee", () => {
  it("off: the request as it is", () => {
    const asked = request(QA);
    expect(withDifferentEmployee(asked, PEOPLE)).toBe(asked);
  });

  it.each(cased(QA))('card on screen, "%s": B\'s own request from this turn only, nothing of A\'s card', (question) => {
    on();
    const read = withDifferentEmployee(request(question), PEOPLE);
    expect(read.history).toEqual([]);
    expect(read.continueProposalTemplateKey).toBeUndefined();
    expect(read.activeFormInstanceId).toBeUndefined();
    expect(read.differentEmployeeFor).toEqual({ employeeName: "Test Employee Two" });
    expect(read.question).toMatch(/^a Corrective Action Form for Test Employee Two\b/i);
    expect(read.question).toMatch(/10-20-26/);
  });

  it("after Create: the open form's employee and form", () => {
    on();
    const read = withDifferentEmployee(request(QA, { continueProposalTemplateKey: undefined, activeFormInstanceId: "f-1" }), PEOPLE, {
      employeeName: "Test Employee",
      templateName: "Corrective Action Form",
    });
    expect(read.activeFormInstanceId).toBeUndefined();
    expect(read.history).toEqual([]);
    expect(read.question).toBe("a Corrective Action Form for Test Employee Two at Lawrence for being late on 10-20-26");
  });

  it("A's own turn is A's: the request as it is", () => {
    on();
    const asked = request("now one for Test Employee at Lawrence for being late on 10-22-26");
    expect(withDifferentEmployee(asked, PEOPLE)).toBe(asked);
  });
});

describe("withDifferentEmployeeSources", () => {
  it("B's card is drafted from this turn only", () => {
    on();
    const card = { employeeName: "Test Employee Two", sourceMessageIds: ["m1", "m2"] };
    const out = withDifferentEmployeeSources({ formProposal: card } as never, { questionMessageId: "m2", differentEmployeeFor: { employeeName: "Test Employee Two" } } as never);
    expect(out.formProposal?.sourceMessageIds).toEqual(["m2"]);
  });

  it('a card read as "Test" (the name reader stops at "Employee") names Test Employee Two, as the reading did', () => {
    on();
    const card = { employeeName: "Test", sourceMessageIds: ["m2"], wovenCloseMatch: "Woven has Test Employee or Test Employee Two" };
    const out = withDifferentEmployeeSources({ formProposal: card } as never, { questionMessageId: "m2", differentEmployeeFor: { employeeName: "Test Employee Two" } } as never);
    expect(out.formProposal).toMatchObject({ employeeName: "Test Employee Two", sourceMessageIds: ["m2"] });
    expect((out.formProposal as { wovenCloseMatch?: string }).wovenCloseMatch).toBeUndefined();
  });

  it("a card for somebody else entirely is left as it is", () => {
    on();
    const card = { employeeName: "Mara Quell", sourceMessageIds: ["m2"] };
    const response = { formProposal: card } as never;
    expect(withDifferentEmployeeSources(response, { questionMessageId: "m2", differentEmployeeFor: { employeeName: "Test Employee Two" } } as never)).toBe(response);
  });
});

describe("differentEmployeeReadConversation (Create's currency check)", () => {
  const turns = [
    { role: "user", content: "I need a corrective action for Test Employee, she was late opening the salon on Monday" },
    { role: "assistant", content: "Here is what I would put on a Corrective Action Form." },
    { role: "user", content: QA },
  ];

  it("off: the conversation as sent", () => {
    expect(differentEmployeeReadConversation(turns, PEOPLE)).toBe(turns);
  });

  it("on: read from B's request on, as the chat read it", () => {
    on();
    expect(differentEmployeeReadConversation(turns, PEOPLE)).toEqual([
      { role: "user", content: "a form for Test Employee Two at Lawrence for being late on 10-20-26" },
    ]);
  });
});
