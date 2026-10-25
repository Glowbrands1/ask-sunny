import { describe, expect, it } from "vitest";

import {
  claimsAnotherChat,
  CROSS_CHAT_NEUTRAL_REPLY,
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

/*
 * QA, second pass on 25 Oct: two more live sentences, QA's exact wording, that
 * the backstop KEPT after the six below were fixed. One reads the manager's
 * earlier write-ups back to them ("your last two write-ups … were at"); the
 * other counts them as things the manager told ("a third documented issue …
 * that you've told me about") and carries a date this conversation never had.
 */
const LIVE_TWO = [
  "Your last two write-ups for this name were at Empire, SD and Dodge, NE.",
  "This would be a third documented issue for Test Employee that you've told me about — a verbal for the Dodge, NE attendance/no-call issue (10-20-26) and a verbal for the Empire, SD puppy visit (10-22-26).",
];

/* The manager's first turn in that live conversation, names swapped. */
const EMPIRE_TURN =
  "do verbal for team member Test Employee at empire, sd. payroll deduct does not apply. previous coaching jba manual 11-1-26. on 10-22-26 Test was not scheduled to work and came into the store to show her team her new puppy. Test was in the store 45 min";

/*
 * QA review, 25 Oct: the first version KEPT all six of these. They are
 * the sibling app's live step-3 replies (conv_mvmzl3vs2kxujv0, conv_mvmzl40e2dxpgej, conv_mvmzlbhv2ww7y5v, conv_mvmzlvq124nmks8, conv_mvmznap42vcw0dl), with its store names swapped for invented salon labels and the manager's name for an invented one. The manager did not refer back to anything; every one must go, and
 * the policy sentence beside them must stay.
 */
describe("withoutCrossChatClaims — QA's six live sentences", () => {
  const SIX = [
  "Thanks, Marlo. I see a couple of earlier items on Test Employee from your past conversations: a note about being out of dress code at Salon 0495 on 10-18, and a Corrective Action you created for being late to open (dated 10-22, verbal, no payroll change).",
  "You told me earlier today about a separate CA for Test Employee at Salon 0495 — late to open 10-19, documented as a verbal warning, no payroll deduction.",
  "A quick note on timeline: you already have a Corrective Action on file for Test Employee for a late-to-open on 10-19 (verbal, no payroll change, later corrected to date 10-22, per what you told me earlier).",
  "Salon discrepancy — you've mentioned Test Employee before in two different contexts: a dress code CA request for Salon 0101, and a lateness CA request for Salon 0202.",
  "That matches what you did earlier today for Test Employee's late-arrival verbal.",
  "This is a first documented cell phone issue for her that I can see — your other notes on Test Employee are a dress code CA at Salon 0101 (10/11) and a lateness CA at Salon 0202 (10/5, 10/15).",
  // QA, second pass: two more live sentences the backstop still KEPT, verbatim.
  ...LIVE_TWO,
  ];
  const KEEP = "Personal cell phones must be kept out of sight [p.19].";
  const input = {
    question: "Her name is Test Employee",
    history: [
      { role: "user", content: "I need to coach an employee" },
      { role: "assistant", content: "Happy to help you build this out. What did you observe?" },
    ],
    todayIso: "2026-10-24",
  };

  it.each(SIX.map((sentence, index) => [index + 1, sentence]))("removes sentence %i and keeps the policy line", (_n, sentence) => {
    const { content, removed } = withoutCrossChatClaims(`${sentence} ${KEEP}`, input);
    // "Thanks, Marlo." is a sentence of its own and says nothing about another chat: it stays.
    const kept = sentence.startsWith("Thanks, Marlo. ") ? "Thanks, Marlo. " : "";
    expect(removed).toEqual([sentence.slice(kept.length)]);
    expect(content).toBe(`${kept}${KEEP}`);
  });

  it("removes all of them from one reply and keeps the policy line", () => {
    const { content } = withoutCrossChatClaims([...SIX, KEEP].join("\n\n"), input);
    expect(content).toBe(`Thanks, Marlo.\n\n${KEEP}`);
  });

  it("keeps the policy line and a sentence about this chat on their own", () => {
    const reply = `${KEEP} You said she was on her phone, so start with the policy.`;
    expect(withoutCrossChatClaims(reply, input).content).toBe(reply);
  });
});

describe("refersBack — the manager's own words for an earlier chat", () => {
  it("reads 'like last time', 'the one I did yesterday' and 'her earlier CA'", () => {
    for (const said of ["do it like last time", "same as the one I did yesterday", "add it to her earlier CA"]) {
      expect(refersBack(said, [])).toBe(true);
    }
    expect(refersBack("Her name is Test Employee", [{ role: "user", content: "I need to coach an employee" }])).toBe(false);
    expect(
      refersBack(
        "do verbal for team member Test Employee at empire, sd. payroll deduct does not apply. previous coaching jba manual 11-1-26. on 10-22-26 Test was not scheduled to work and came into the store to show her team her new puppy. Test was in the store 45 min",
        [],
      ),
    ).toBe(false);
  });
});

describe("withoutCrossChatClaims — QA's two further live sentences in their own conversation", () => {
  const input = { question: EMPIRE_TURN, history: [], todayIso: "2026-10-24" };
  const KEEP = "A verbal warning is the first step [p.12].";

  it("the manager's turn does not refer back, so the backstop runs", () => {
    expect(refersBack(EMPIRE_TURN, [])).toBe(false);
  });

  it.each(LIVE_TWO.map((sentence, index) => [index + 1, sentence]))("removes sentence %i and keeps the policy line", (_n, sentence) => {
    const { content, removed } = withoutCrossChatClaims(`${sentence} ${KEEP}`, input);
    expect(removed).toEqual([sentence]);
    expect(content).toBe(KEEP);
  });
});

describe("withoutCrossChatClaims — counts, dates and records that stay", () => {
  it("keeps a date the manager gave here, with 'you told me'", () => {
    const reply = "You told me she came into the store on 10-22-26 to show her team her new puppy.";
    expect(withoutCrossChatClaims(reply, { question: EMPIRE_TURN, history: [], todayIso: "2026-10-24" }).content).toBe(reply);
  });

  it("keeps a count the manager made in this conversation", () => {
    const reply = "This would be the third time she was late that you've told me about, so a written warning fits.";
    const history = [
      { role: "user", content: "Test Employee was late Monday and Tuesday" },
      { role: "assistant", content: "Noted. Anything else?" },
    ];
    const question = "she was late today too, that makes three times this week";
    expect(withoutCrossChatClaims(reply, { question, history, todayIso: "2026-10-24" }).content).toBe(reply);
  });

  it("keeps policy sentences about counts and prior write-ups", () => {
    const reply =
      "A third documented issue within 90 days calls for a written warning [p.12]. If the employee's last two write-ups were for the same behavior, note them on the form. Your last step is the signature line.";
    expect(withoutCrossChatClaims(reply, { question: EMPIRE_TURN, history: [], todayIso: "2026-10-24" }).content).toBe(reply);
  });

  it("does not read '1-2 times' as a date", () => {
    const reply = "You said she was 1-2 times late this week.";
    const history = [{ role: "user", content: "she was late 1-2 times this week" }];
    expect(withoutCrossChatClaims(reply, { question: "what form", history, todayIso: "2026-10-24" }).content).toBe(reply);
  });
});

describe("withoutCrossChatClaims — a reply that was nothing but other chats", () => {
  it("comes back as the neutral line, with every sentence it lost listed", () => {
    const reply = LIVE_TWO.join(" ");
    const { content, removed } = withoutCrossChatClaims(reply, {
      question: "Her name is Test Employee",
      history: [{ role: "user", content: "I need to coach an employee" }],
      todayIso: "2026-10-24",
    });
    expect(content).toBe(CROSS_CHAT_NEUTRAL_REPLY);
    expect(content).toBe("Tell me what happened in this case and I'll help from there.");
    expect(removed).toEqual(LIVE_TWO);
  });

  it("an unchanged reply still lists nothing", () => {
    const reply = "Coach in private, soon after the behaviour.";
    expect(withoutCrossChatClaims(reply, { question: "how do I coach", history: [], todayIso: "2026-10-24" })).toEqual({
      content: reply,
      removed: [],
    });
  });
});

describe("refersBack — a counted earlier record", () => {
  it("reads 'her last two write-ups' and 'my previous CA' as pointing back", () => {
    expect(refersBack("her last two write-ups were for attendance", [])).toBe(true);
    expect(refersBack("attach my previous CA", [])).toBe(true);
  });
});
