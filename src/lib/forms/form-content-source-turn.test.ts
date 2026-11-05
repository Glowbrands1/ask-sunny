import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseHistory } from "@/lib/api/validation";
import type { ChatMessage } from "@/types";

import { formContentRevision, pendingUnwritten, sourceTurn, unwrittenReply, unwrittenTurn } from "./form-content-turn";

/**
 * FORM_EDIT_SOURCE_TURN_ENABLED (coding 3, item 1): the turn an edit refers
 * back to is chosen by the thread's structure — the `card` and `formReply`
 * markers — never "the last reply". The managers' words; people invented.
 */
const FORM = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const OTHER = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";
const OPEN = { templateName: "Coaching Form", employeeName: "Rowan Kestrel", instanceId: FORM };
const FLAGS = ["FORM_EDIT_SOURCE_TURN_ENABLED", "FORM_EDIT_REFERS_BACK_ENABLED"];

type Marked = Pick<ChatMessage, "id" | "role" | "content" | "card" | "formReply">;
let sequence = 0;
const next = () => `t${(sequence += 1)}`;
const user = (content: string): Marked => ({ id: next(), role: "user", content });
const answer = (content: string): Marked => ({ id: next(), role: "assistant", content });
const card = (content = "Here is what I would put on a **Coaching Form**. Create the draft here when you're ready."): Marked => ({ id: next(), role: "assistant", content, card: true });
const reply = (content: string, unwritten?: string, instanceId = FORM): Marked => ({
  id: next(),
  role: "assistant",
  content,
  formReply: { instanceId, ...(unwritten ? { unwritten } : {}) },
});

const HOW_TO = "Here's how to coach on the spray tan booth:\n\n**Details of Coaching:** Press **Start Session** only once the guest is in the booth and ready.";
const NO_CHANGE = "I haven't changed the **Coaching Form** for **Rowan Kestrel** — everything on it is as it was.";
const ROWAN_DID = "rowan marked a session as complete but the guest hadn't been sprayed yet";

const saved = new Map<string, string | undefined>();
beforeEach(() => {
  for (const name of FLAGS) {
    saved.set(name, process.env[name]);
    process.env[name] = "true";
  }
});
afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("sourceTurn", () => {
  it("skips the card: the answer before it", () => {
    expect(sourceTurn([user("how do i coach on the booth?"), answer(HOW_TO), user("Create a coaching form for Rowan Kestrel"), card()], FORM)).toEqual({
      text: "Press **Start Session** only once the guest is in the booth and ready.",
      from: "answer",
    });
  });

  it("skips the bot's own replies about the open form", () => {
    const history = [answer(HOW_TO), card(), user("can you upate the draft with these details of coaching?"), reply(NO_CHANGE), user("it didnt edit in the card"), reply(NO_CHANGE)];
    expect(sourceTurn(history, FORM)?.from).toBe("answer");
    expect(sourceTurn(history, FORM)?.text).toMatch(/Start Session/);
  });

  it("an answer after the card, before Create, is a source too", () => {
    expect(sourceTurn([card(), user("what should the expectation say?"), answer("Expect the room checked before every guest.")], FORM)?.text).toBe(
      "Expect the room checked before every guest.",
    );
  });

  it("the pending unwritten turn, when it is the most recent", () => {
    const history = [answer(HOW_TO), card(), user(ROWAN_DID), reply(NO_CHANGE, ROWAN_DID)];
    expect(sourceTurn(history, FORM)).toEqual({ text: ROWAN_DID, from: "unwritten" });
  });

  it("an unwritten turn is pending only on the latest reply about the form", () => {
    const history = [answer(HOW_TO), card(), user(ROWAN_DID), reply(NO_CHANGE, ROWAN_DID), user("make that update"), reply("Updated the Coaching Form.")];
    expect(sourceTurn(history, FORM)?.from).toBe("answer");
    expect(pendingUnwritten(history, FORM)).toBeNull();
  });

  it("another form's unwritten turn is not this form's", () => {
    expect(pendingUnwritten([card(), reply(NO_CHANGE, ROWAN_DID, OTHER)], FORM)).toBeNull();
    expect(sourceTurn([card(), reply(NO_CHANGE, ROWAN_DID, OTHER)], FORM)).toBeNull();
  });
});

describe("formContentRevision with FORM_EDIT_SOURCE_TURN_ENABLED", () => {
  it('"these details" is handed the answer before the card, verbatim (no start → begin)', () => {
    const revised = formContentRevision({
      ...OPEN,
      question: "can you upate the draft with these details of coaching?",
      history: [answer(HOW_TO), card()],
    });
    expect(revised?.question).toBe("Add the details in my last message to the Details of Coaching.");
    expect(revised?.history.at(-1)).toMatchObject({ role: "user", content: "Press **Start Session** only once the guest is in the booth and ready." });
    expect(revised?.source).toBe("earlier");
  });

  it('"the details we just discussed!!!" after two no-change replies: still the answer', () => {
    const revised = formContentRevision({
      ...OPEN,
      question: "the details we just discussed!!!",
      history: [answer(HOW_TO), card(), user("can you upate the draft with these details of coaching?"), reply(NO_CHANGE), user("it didnt edit in the card"), reply(NO_CHANGE)],
    });
    expect(revised?.history.at(-1)?.content).toMatch(/Start Session/);
  });

  it('"make that update" is handed the pending unwritten turn', () => {
    const revised = formContentRevision({
      ...OPEN,
      question: "make that update",
      history: [card(), user(ROWAN_DID), reply(NO_CHANGE, ROWAN_DID), user("Do i need to copy and paste it?"), reply("**Nothing on the form has changed yet.**", ROWAN_DID)],
    });
    expect(revised?.history.at(-1)?.content).toBe(ROWAN_DID);
  });

  it("a thread saved before the markers falls back to the last reply, as before", () => {
    const plain = [answer(HOW_TO), user("Create a coaching form for Rowan Kestrel"), answer("Here is what I would put on a **Coaching Form**."), user("ok"), answer(NO_CHANGE)];
    const revised = formContentRevision({ ...OPEN, question: "can you upate the draft with these details of coaching?", history: plain });
    expect(revised?.history.at(-1)?.content ?? revised?.question).not.toMatch(/Start Session/);
  });

  it("off: the last reply, as before", () => {
    delete process.env.FORM_EDIT_SOURCE_TURN_ENABLED;
    const revised = formContentRevision({ ...OPEN, question: "can you upate the draft with these details of coaching?", history: [answer(HOW_TO), card()] });
    expect(revised?.question).toMatch(/Here is what I would put/);
    expect(revised?.history.at(-1)?.content).not.toMatch(/Start Session/);
  });

  it("the manager's own account is her turn", () => {
    expect(formContentRevision({ ...OPEN, question: ROWAN_DID, history: [card()] })?.source).toBe("turn");
  });
});

describe("unwrittenTurn / unwrittenReply", () => {
  it("a turn about the form itself is not content", () => {
    expect(unwrittenTurn("it didnt edit in the card")).toBeNull();
    expect(unwrittenTurn(ROWAN_DID)).toBe(ROWAN_DID);
  });

  it("says what is not on the form, from the saved state, and keeps a cited answer without its claims", () => {
    const text = unwrittenReply({
      unwritten: ROWAN_DID,
      templateName: "Coaching Form",
      employeeName: "Rowan Kestrel",
      canWrite: true,
      citedAnswer: "I've updated the draft card.\nThe manual says to check the booth before each guest.",
    });
    expect(text).toMatch(/Nothing on the form has changed yet/);
    expect(text).toContain(ROWAN_DID);
    expect(text).toMatch(/make that update/);
    expect(text).toMatch(/check the booth before each guest/);
    expect(text).not.toMatch(/I've updated/);
  });
});

describe("parseHistory markers", () => {
  const sent = [
    { id: "m1", role: "user", content: "how do i coach on the booth?" },
    { id: "a1", role: "assistant", content: HOW_TO },
    { id: "a2", role: "assistant", content: "card", formProposal: { templateKey: "coaching" } },
    { id: "a3", role: "assistant", content: "created", formInstanceRef: { instanceId: FORM } },
    { id: "a4", role: "assistant", content: NO_CHANGE, formReply: { instanceId: FORM, unwritten: ROWAN_DID } },
    { id: "a5", role: "assistant", content: NO_CHANGE, formReply: { instanceId: "not-a-uuid", unwritten: "x" } },
    { id: "a6", role: "assistant", content: NO_CHANGE, formReply: { instanceId: FORM, unwritten: "y".repeat(5_000) } },
  ];

  it("keeps the card and formReply markers, bounded", () => {
    const parsed = parseHistory(sent, { markers: true });
    expect(parsed[0]).toEqual({ id: "m1", role: "user", content: "how do i coach on the booth?" });
    expect(parsed[1]).toEqual({ id: "a1", role: "assistant", content: HOW_TO });
    expect(parsed[2]!.card).toBe(true);
    expect(parsed[3]!.card).toBe(true);
    expect(parsed[4]!.formReply).toEqual({ instanceId: FORM, unwritten: ROWAN_DID });
    expect(parsed[5]!.formReply).toBeUndefined();
    expect(parsed[6]!.formReply?.unwritten).toHaveLength(2_000);
    expect(JSON.stringify(parsed)).not.toMatch(/templateKey|formProposal|formInstanceRef/);
  });

  it("off: id, role and content only, as before", () => {
    expect(parseHistory(sent).every((turn) => Object.keys(turn).every((key) => ["id", "role", "content"].includes(key)))).toBe(true);
  });
});
