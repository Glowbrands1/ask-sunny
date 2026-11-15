import { describe, expect, it } from "vitest";

import { asksAboutPastForms, pastFormsPerson } from "./tools";

/*
 * PAST FORMS ONLY WHEN ASKED (Pau's privacy rule; QA's review of #992, 14 Nov 2026). QA's probe sentences, their wording
 * kept and the people invented: ordinary incident wording ("before", "records", "history", "did she get a …", "last
 * time") never opens forms on file; a request that names forms or discipline on file does.
 */
const ask = (question: string) => asksAboutPastForms({ question, history: [] });

const CLOSED = [
  "she left before closing and didnt clean the beds",
  "she didnt record the lotion sales",
  "did she get a break today? she was rude to a client",
  "she said she has a history of migraines",
  "clocked in 20 min late, she was told before about being on time",
  "need a ca for wren, last time i told her no phone",
  "do a coaching for ottilie she was late tuesday",
  "her history of migraines came up again",
  // QA's second probe (14 Nov 2026): requests for a NEW form, and incident wording.
  "do you have a form for tardiness",
  "does she have to sign the form",
  "do a ca for ottilie before her shift ends",
  "give her a verbal warning before she clocks out",
  "fill out the form before she leaves",
  "i coached her before close on cleaning beds",
  "she was given a warning by the customer to stop",
  "she was told last week by the dm, need a written",
  "pls do a ca on her she was late AGAIN",
  "she was on her phone the whole shift, last shift too",
  // QA (14 Nov 2026): "already has one" with no form word in the same message stays closed.
  "she already has one",
  "she already has one, she was late again",
  // QA's 266-chat shadow replay (batch K7): neighbours of the new asks stay closed.
  "we just created a new policy for phones",
  "we just created a new schedule, she was late on it",
  "find a coaching form for tardiness",
  "find me a form for the late policy",
  "look for a better way to word this",
  "can you look for the policy on phones",
  "pull that policy up",
  "bring it up with her at the next meeting",
  "bring her back for another training shift",
  // QA's review of #1021: asking for a NEW form (or its template) never opens the lock; only retrieving an EXISTING form of a person does.
  "can you find the form I need for a no show",
  "find the right form for a no call no show",
  "find the correct form for tardiness",
  "find me the best form for this",
  "find the form for a termination",
  "find the corrective action form please",
  "find the form to write her up",
  "can you find the CA form, I need to write Juno up",
  "find my form, I want to make a CA for Remy",
  "find the warning she needs for this",
  "find their warning letter template",
  "look for the coaching form template",
  "find that coaching sheet",
  "locate the exit form so I can fill it out for Remy",
  "look for the termination form, she quit",
  "look for exit form",
  "write up a CA, she needs to bring it back tomorrow",
  "give her the write up and bring it back signed",
  "the CA, bring it up with her at the meeting",
  "make a CA, I'll pull it up on my phone",
  "the form that I just made a mistake on",
];

const OPEN = [
  "has she had any write ups",
  "change the date on my last CA for ottilie",
  "what's on file for wren",
  "has she been written up before",
  "had a CA before?",
  "show me her disciplinary history",
  "pull up ottilie's record",
  "same as last time",
  "open my previous coaching for wren",
  "does she have any write ups",
  "has she been written up before?",
  "written up before.",
  "i coached her before for this",
  // QA (14 Nov 2026): the same message names a form word AND says the person already has one.
  "she already has a CA but the policy wasn't listed",
  "she already has a verbal, now do a written",
  "I need you to draw me up a a coachong document for Wrenna. She already has one but the policy was not listed",
  // QA (14 Nov 2026), the MSB family: the manager asks for another employee's CA as the format (invented names).
  "...but i need it to be in the format of Corvina Lisle's ca it needs to look exactally the same as corvina lisles but wtih all of this information",
  "make it look the same as corvinas ca",
  // QA's 266-chat shadow replay (batch K7), their wording, people invented: explicit asks the gate under-read.
  // Reworded only as far as QA's rule needs (retrieving an existing form of a named or possessed person).
  "look for Marnie Holloway's exit form",
  "find her coaching form",
  "find Juno Paxton's CA",
  "find the exit form for Remy Calder on file",
  "the coaching form for Marnie Holloway that we just created, can you pull it back up",
  "Remy Calder's CA, can you pull it back up",
  "the coaching form we did for Juno Paxton, pull it up",
];

describe("the past-forms gate stays tied to the person it was opened for (QA's review of #1021)", () => {
  const person = (question: string) => pastFormsPerson({ question, history: [] });
  it("a CA that we just made for one person does not allow another's forms", () => {
    expect(ask("a CA that we just made for Juno, now do one for Remy")).toBe(true);
    expect(person("a CA that we just made for Juno, now do one for Remy")?.toLowerCase()).toContain("juno");
    expect(person("the coaching form for Marnie Holloway that we just created, can you pull it back up")?.toLowerCase()).toContain("marnie");
  });
  it("an ask that names no person, or the older patterns, are not tied", () => {
    expect(person("what's on file for wren")).toBeNull();
    expect(person("find her coaching form")).toBeNull();
  });
});

describe("the past-forms gate", () => {
  it.each(CLOSED)("stays closed: %s", (question) => expect(ask(question)).toBe(false));
  it.each(OPEN)("opens: %s", (question) => expect(ask(question)).toBe(true));
  it("a short answer is read with the manager's message before it", () => {
    expect(asksAboutPastForms({ question: "yes", history: [{ id: "1", role: "user", content: "has she had any write ups", createdAt: "" } as never] })).toBe(true);
    expect(asksAboutPastForms({ question: "yes", history: [{ id: "1", role: "user", content: "she left before closing", createdAt: "" } as never] })).toBe(false);
  });
});
