import { describe, expect, it } from "vitest";

import {
  claimsAnotherChat,
  isBareNameTurn,
  refersBack,
  withoutCrossChatClaims,
} from "./cross-chat-guard";

/**
 * ============================================================================
 * QA: THE REPLY BROUGHT OTHER CHATS INTO THE TEXT
 * ============================================================================
 *
 * The manager's turns and Sunny's replies are the production ones from
 * conv_mvmtj8ia2qwr8pu, conv_mvmw29wp27tkony and conv_mvmvugx525mtd2v, with
 * the people's names swapped for invented ones (Wren Calder, Marlo).
 */

const SITUATION =
  "an employee (Wren)  is talking negatively about co workers and customers. another employee, marlo, complained to salon director about Wren";

const REPLY_OCT_23 = `You raised this same situation with me on October 23, and in that conversation you asked for a coaching form for Wren Calder, tanning consultant at Lawrence. Worth checking Forms → Form Monitoring to see whether that one was actually created — if it was, and you've already had the conversation with Wren, the right record now is a **Follow-Up Coaching Form** rather than a second coaching form. If the first one never got finished, a **Coaching Form** is still the right place to start.

For the conversation itself, keep it on behavior and impact, not personality.

When you're ready, tell me which one you want — for example "create a follow-up coaching form for Wren Calder" — and the draft card will come up here.`;

const REPLY_OCT_23_SECOND = `You raised this same situation with me on October 23 — Wren Calder, Tanning Consultant at Lawrence, with Marlo having gone to the Salon Director about the negative talk. In those conversations you asked about a coaching form, but I can't confirm one was ever created; nothing shows on record here.

For the conversation itself, keep it on behavior, expectation and impact.

If you want this documented, ask me to create a coaching form for Wren Calder and I'll put up the draft here.`;

const REPLY_AUG_26 = `I'm not sure what you're after — that came through as a stray keystroke. (You sent the same thing back on August 26, so if there was a real question behind it, it didn't make it through either time.)

Tell me what you need and I'll take it from there. A few things I can help with:

- Coaching conversations and how to approach them.

What's on your plate today?`;

const TODAY = "2026-10-24";

describe("withoutCrossChatClaims — the production replies", () => {
  it('takes out "You raised this same situation with me on October 23" and keeps every other word', () => {
    const { content, removed } = withoutCrossChatClaims(REPLY_OCT_23, {
      question: SITUATION,
      history: [],
      todayIso: TODAY,
    });
    expect(content).not.toMatch(/you raised/i);
    expect(content).not.toContain("October 23");
    expect(removed).toHaveLength(1);
    expect(content).toBe(
      REPLY_OCT_23.replace(
        "You raised this same situation with me on October 23, and in that conversation you asked for a coaching form for Wren Calder, tanning consultant at Lawrence. ",
        "",
      ),
    );
  });

  it('takes out "In those conversations you asked about a coaching form" with it', () => {
    const { content } = withoutCrossChatClaims(REPLY_OCT_23_SECOND, {
      question: SITUATION,
      history: [],
      todayIso: TODAY,
    });
    expect(content).not.toMatch(/you raised|you asked|those conversations/i);
    expect(content.startsWith("For the conversation itself, keep it on behavior, expectation and impact.")).toBe(true);
    expect(content).toContain("ask me to create a coaching form for Wren Calder");
  });

  it('takes out "(You sent the same thing back on August 26, …)" after a lone "asdasd"', () => {
    const { content } = withoutCrossChatClaims(REPLY_AUG_26, {
      question: "asdasd",
      history: [],
      todayIso: TODAY,
    });
    expect(content).not.toMatch(/you sent|August 26/i);
    expect(content.startsWith("I'm not sure what you're after — that came through as a stray keystroke.")).toBe(true);
    expect(content).toContain("Tell me what you need and I'll take it from there.");
    expect(content).toContain("What's on your plate today?");
  });
});

describe("withoutCrossChatClaims — what stays", () => {
  it("keeps a prior form listed as a record", () => {
    const reply =
      "**Possibly on file — not added:** Coaching Form dated 2026-10-01 (Lawrence). I can't confirm these are this employee's, so I won't put it on the form.";
    expect(withoutCrossChatClaims(reply, { question: SITUATION, history: [], todayIso: TODAY }).content).toBe(reply);
  });

  it("keeps a date the manager gave in this conversation", () => {
    const reply = "You mentioned on October 21 that she was late. That is the second late arrival.";
    const history = [{ role: "user", content: "Wren Calder was late on 10/21" }];
    expect(withoutCrossChatClaims(reply, { question: "what now", history, todayIso: TODAY }).content).toBe(reply);
  });

  it("keeps 'the same thing' when the manager repeated it in this conversation", () => {
    const reply = "You sent the same thing twice, so I think it was a stray keystroke.";
    const history = [{ role: "user", content: "asdasd" }, { role: "assistant", content: "Not sure what you mean." }];
    expect(withoutCrossChatClaims(reply, { question: "asdasd", history, todayIso: TODAY }).content).toBe(reply);
  });

  it("keeps advice that only says what the manager asked here", () => {
    const reply = "You asked for a coaching form for Wren Calder. Here is what I would put on it.";
    expect(claimsAnotherChat(reply, { question: SITUATION, history: [], todayIso: TODAY })).toBe(false);
  });
});

describe("refersBack and isBareNameTurn", () => {
  it("reads the manager pointing back at an earlier chat", () => {
    for (const said of [
      "Wren is talking negatively again",
      "same as last time with Wren",
      "do it like before",
      "same issue as Wren had",
      "in my other chat I said she was late",
      "I told you about Wren yesterday",
    ]) {
      expect(refersBack(said, [])).toBe(true);
    }
    expect(refersBack(SITUATION, [])).toBe(false);
    expect(refersBack("asdasd", [])).toBe(false);
    expect(refersBack("what now?", [{ role: "user", content: "Wren was late again" }])).toBe(true);
    expect(refersBack("what now?", [{ role: "assistant", content: "Last time you said…" }])).toBe(false);
  });

  it("knows a turn that is nothing but the name", () => {
    expect(isBareNameTurn("asdasd", "asdasd")).toBe(true);
    expect(isBareNameTurn("Wren Calder.", "Wren Calder")).toBe(true);
    expect(isBareNameTurn("create a coaching form for Wren Calder", "Wren Calder")).toBe(false);
    expect(isBareNameTurn(SITUATION, "Wren")).toBe(false);
  });
});
