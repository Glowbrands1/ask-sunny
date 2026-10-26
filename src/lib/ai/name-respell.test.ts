import { afterEach, describe, expect, it } from "vitest";

import type { ChatFormProposal } from "@/types";

import { respelling, withNameRespell } from "./name-respell";
import type { AskRequest, AskResponse } from "./types";

/**
 * Ask Sunny conv_mvofjlco271mr0t, 25 Oct 2026. The manager's turns exactly,
 * with an invented name spelled the same two ways ("wren caloway", then
 * "wren calloway").
 */
const FLAG = "NAME_RESPELL_ENABLED";
const saved = process.env[FLAG];
afterEach(() => {
  if (saved === undefined) delete process.env[FLAG];
  else process.env[FLAG] = saved;
});

const CARD = { templateKey: "dpoa", templateName: "Corrective Action Form", employeeName: "Wren Caloway", status: "ready" } as ChatFormProposal;
const REPLY = "I'll draft a **Corrective Action Form** for **wren caloway** from what you've described.";
const RESPONSE = { content: REPLY, citations: [], formProposal: CARD } as unknown as AskResponse;
const TURN = "wren calloway, tc, ks manhattan";
const HISTORY = [{ role: "user", content: "crete a ca for wren caloway bc she didnt do the deep clean i assignd by 9-15" }];

describe("NAME_RESPELL_ENABLED", () => {
  it("off: keeps the first spelling, as main does", () => {
    delete process.env[FLAG];
    expect(withNameRespell(RESPONSE, { question: TURN, history: HISTORY } as unknown as AskRequest)).toBe(RESPONSE);
  });

  it("on: the newest spelling goes on the card and in the reply", () => {
    process.env[FLAG] = "on";
    const out = withNameRespell(RESPONSE, { question: TURN, history: HISTORY } as unknown as AskRequest);
    expect(out.formProposal?.employeeName).toBe("Wren Calloway");
    expect(out.content).toBe("I'll draft a **Corrective Action Form** for **Wren Calloway** from what you've described.");
  });

  it("on: a directory spelling the manager never typed is not replaced by a typo", () => {
    process.env[FLAG] = "on";
    const directory = { ...RESPONSE, formProposal: { ...CARD, employeeName: "Wren Calloway" } };
    const out = withNameRespell(directory, { question: "wren caloway, tc", history: [{ role: "user", content: "ca for wren calowy" }] } as unknown as AskRequest);
    expect(out).toBe(directory);
  });

  it("on: the same spelling, another person or a request turn changes nothing", () => {
    process.env[FLAG] = "on";
    expect(respelling("Wren Caloway", "wren caloway, tc")).toBeNull();
    expect(respelling("Wren Caloway", "create a ca for avery stone")).toBeNull();
    expect(respelling("Wren Caloway", "Create a Corrective Action Form from this conversation.")).toBeNull();
    expect(respelling("Wren Caloway", "Brenn Calloway")).toBeNull();
  });

  it("on: reads the respelling in capitals and in lowercase", () => {
    process.env[FLAG] = "on";
    for (const question of [TURN.toUpperCase(), TURN.toLowerCase(), TURN[0]!.toUpperCase() + TURN.slice(1), TURN.replace("calloway", "Calloway")]) {
      const out = withNameRespell(RESPONSE, { question, history: HISTORY } as unknown as AskRequest);
      expect(out.formProposal?.employeeName).toBe("Wren Calloway");
    }
  });
});

/** QA-6 negation probes, 26 Oct 2026: a negated mention is not the newest spelling. */
describe("NAME_RESPELL_ENABLED on: a negated spelling is never taken", () => {
  it.each(["never Mara Quill", "not Mara Quill but Brenn Calloway", "not for mara quill", "No, not Mara Quill", "without mara quill", "mara quil, not mara quill", "its mara quil never mara quill", "it is not mara quill"])("'%s' leaves the card's spelling", (turn) => {
    expect(respelling("Mara Quil", turn)).toBeNull();
  });

  it("a plain respelling, and the correction 'no, mara quill', are still taken", () => {
    expect(respelling("Mara Quil", "it's Mara Quill")).toBe("Mara Quill");
    expect(respelling("Mara Quil", "no, mara quill")).toBe("mara quill");
    expect(respelling("Mara Quil", "No, Mara Quill")).toBe("Mara Quill");
  });
});
