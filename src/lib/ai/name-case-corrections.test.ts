import { afterEach, describe, expect, it } from "vitest";

import { employeeState, managerContext } from "@/lib/forms/proposal";

import { titleCaseName, withNameCase, withNameTitleCase } from "./name-case";
import type { AskRequest, AskResponse } from "./types";

/**
 * QA-3, 26 Oct 2026, for NAME_CASE_INSENSITIVE_ENABLED: correction turns and
 * name gaps, with the flag on, in lowercase, sentence case and capitals. The
 * manager's wording; every person is invented.
 *
 * Not pinned here: "for rowan testcase opend late" (read "Rowan Testcase
 * opend") and "for Test Employee" (read "Test") read the same way on main in
 * mixed case. They are the name reader's (forms/proposal.ts), not this flag's.
 */
const FLAG = "NAME_CASE_INSENSITIVE_ENABLED";
const saved = process.env[FLAG];
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

function sentenceCase(text: string): string {
  const lower = text.toLowerCase();
  return lower[0]!.toUpperCase() + lower.slice(1);
}

function variants(text: string): string[] {
  return [text.toLowerCase(), sentenceCase(text), text.toUpperCase()];
}

/** The employee after the manager's turns, with the flag's rewrite applied first. */
function employeeAfter(...turns: string[]): string | null {
  process.env[FLAG] = "on";
  const request = withNameCase({
    question: turns[turns.length - 1]!,
    history: turns.slice(0, -1).map((content) => ({ role: "user", content })),
  } as unknown as AskRequest);
  const history = request.history.map((turn, index) => ({ id: `u${index}`, role: "user" as const, content: turn.content as string }));
  const state = employeeState(managerContext(history, { id: "now", content: request.question })).resolution;
  return state.kind === "resolved" ? state.employeeName : null;
}

const OPENED = "create a ca for devon harlan, late today";

describe("NAME_CASE_INSENSITIVE_ENABLED on: a correction names the new person", () => {
  it.each([...variants("actually it's rory vance"), ...variants("no, it's Rory Vance"), ...variants("name is rory vance")])("%s", (reply) => {
    expect(employeeAfter(OPENED, reply)?.toLowerCase()).toBe("rory vance");
  });

  it.each(variants("the name is devon harlan, not coaching, make it a ca"))("%s", (reply) => {
    expect(employeeAfter("create a coaching form for rory vance", reply)?.toLowerCase()).toBe("devon harlan");
  });
});

describe("NAME_CASE_INSENSITIVE_ENABLED on: the surname is never cut after a blank opener", () => {
  const ACCOUNT = "Devon harlan, ks manhattan, was on her phone 25 min customers waiting 9-29-26";
  it.each([
    ...variants("Create a ca.").map((opener) => [opener, ACCOUNT] as const),
    ...variants("Create an exit form.").map((opener) => [opener, ACCOUNT] as const),
    ...variants(ACCOUNT).map((account) => ["Create a ca.", account] as const),
  ])("%s / %s", (opener, account) => {
    expect(employeeAfter(opener, account)?.toLowerCase()).toBe("devon harlan");
  });
});

/**
 * QA live run, 26 Oct 2026 (the sibling app's tester G14, conv_mvom3ssl2g7q7kn and
 * conv_mvom3x2b2a98o2u; the same reader in both apps): a chatty exit that
 * names the person after "one of my team members," left the Employee blank.
 */
describe("NAME_CASE_INSENSITIVE_ENABLED on: the person after 'one of my team members,'", () => {
  const EXIT =
    "hi, one of my team members, devon harlan at our lawrence, ks salon, gave her notice on 9/25/26 and worked through 10/9/26, she is resigning to pursue other career options, she returned all her salon items, no payroll deduction applies and she is eligible for rehire. can you create the exit form?";
  it.each(variants(EXIT))("%s", (turn) => {
    expect(employeeAfter(turn)?.toLowerCase()).toBe("devon harlan");
  });

  it.each(variants("my employee pat rivera was 10 minutes late on 10/5 and 10/15. create a ca"))("%s", (turn) => {
    expect(employeeAfter(turn)?.toLowerCase()).toBe("pat rivera");
  });
});

/**
 * QA coordinator, 26 Oct 2026: with the flag on, the card stores the name in
 * Title Case word by word; a word with a capital inside it stays as typed.
 */
describe("NAME_CASE_INSENSITIVE_ENABLED on: the card's name in Title Case, word by word", () => {
  it.each([
    ["rory vance", "Rory Vance"],
    ["Rory vance", "Rory Vance"],
    ["MARLOWE CO", "Marlowe Co"],
    ["mary anne cruz", "Mary Anne Cruz"],
    ["mary-jane", "Mary-Jane"],
    ["o'brien", "O'Brien"],
    ["McDonald", "McDonald"],
    ["DeShawn", "DeShawn"],
    ["rOsAlYn Co", "rOsAlYn Co"],
  ])("%s → %s", (typed, stored) => {
    expect(titleCaseName(typed)).toBe(stored);
  });

  it("changes the card and the reply with the flag on, nothing with it off", () => {
    const response = {
      content: "I'll draft a **Corrective Action Form** for **rory vance**.",
      citations: [],
      formProposal: { employeeName: "rory vance" },
    } as unknown as AskResponse;
    delete process.env[FLAG];
    const request = { question: "create a ca for rory vance", history: [] } as unknown as AskRequest;
    expect(withNameTitleCase(response, request)).toBe(response);
    process.env[FLAG] = "on";
    const out = withNameTitleCase(response, request);
    expect(out.formProposal?.employeeName).toBe("Rory Vance");
    expect(out.content).toBe("I'll draft a **Corrective Action Form** for **Rory Vance**.");
  });
});

/**
 * QA-5, 26 Oct 2026 (flag on): the reply was changed inside other words, and
 * name particles were capitalised; the directory's spelling must win.
 */
describe("NAME_CASE_INSENSITIVE_ENABLED on: whole words, particles and the directory's spelling", () => {
  const ask = (question: string) => ({ question, history: [] }) as unknown as AskRequest;
  const reply = (name: string, content: string) => ({ content, citations: [], formProposal: { employeeName: name } }) as unknown as AskResponse;

  it.each([
    // QA-5, 26 Oct 2026: changed on purpose — a one-word name is changed only in bold, so "manager ann" stays as written.
    ["ann", "...for **ann**. Planning notes: the annual review and manager ann will sign.", "...for **Ann**. Planning notes: the annual review and manager ann will sign."],
    ["al", "...for **al**. The policy, total deduct and local rules apply.", "...for **Al**. The policy, total deduct and local rules apply."],
    ["jo", "...for **jo**. Joint review and job duties.", "...for **Jo**. Joint review and job duties."],
  ])("'%s' is changed on whole words only", (name, content, shown) => {
    process.env[FLAG] = "on";
    expect(withNameTitleCase(reply(name, content), ask(`create a ca for ${name}`)).content).toBe(shown);
  });

  it.each([
    ["van der berg", "Van der Berg"],
    ["de la cruz", "De la Cruz"],
    ["maria del rio", "Maria del Rio"],
    ["omar al-amin", "Omar al-Amin"],
    ["mary-jane smith", "Mary-Jane Smith"],
    ["d'angelo", "D'Angelo"],
  ])("%s → %s", (typed, stored) => {
    expect(titleCaseName(typed)).toBe(stored);
  });

  it("a name the directory spelled is kept: 'van der berg' typed, the card shows 'Van der Berg'", () => {
    process.env[FLAG] = "on";
    const directory = reply("van Der Berg", "for **van Der Berg**");
    expect(withNameTitleCase(directory, ask("create a ca for van der berg"))).toBe(directory);
  });
});

/** QA-5, 26 Oct 2026: a one-word name that is an ordinary word, and a particle before the surname. Names invented. */
describe("NAME_CASE_INSENSITIVE_ENABLED on: a one-word name is changed only where it is the name", () => {
  const ask = (question: string) => ({ question, history: [] }) as unknown as AskRequest;
  const reply = (name: string, content: string) => ({ content, citations: [], formProposal: { employeeName: name } }) as unknown as AskResponse;

  it.each(["create a ca for will", "Create a ca for will"])("'%s': only **will** becomes **Will**", (question) => {
    process.env[FLAG] = "on";
    const out = withNameTitleCase(reply("will", "I'll draft it for **will**. She will sign and will be late. **will**'s manager will review it."), ask(question));
    expect(out.content).toBe("I'll draft it for **Will**. She will sign and will be late. **Will**'s manager will review it.");
    expect(out.formProposal?.employeeName).toBe("Will");
  });

  it.each(["ca for van der berg late open", "Ca for van der berg late open", "CA FOR VAN DER BERG LATE OPEN"])("'%s' reads the name as 'Van der Berg'", (question) => {
    process.env[FLAG] = "on";
    expect(withNameCase(ask(question)).question).toContain("Van der Berg");
  });

  it("a lowercase third word after an ordinary second word is still not a name: 'rowan testcase opend'", () => {
    process.env[FLAG] = "on";
    expect(withNameCase(ask("ca for rowan testcase opend late")).question).not.toContain("Opend");
  });
});
