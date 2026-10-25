import { describe, expect, it } from "vitest";

import {
  historySaysDifferentIncident,
  incidentQuestionAsked,
  readDraftDelete,
  readIncidentAnswer,
} from "./draft-actions";

/* QA F8. The manager's own words first; every person is synthetic. */

const OPENED =
  "The **Corrective Action Form** for **Marlo Quist** was finalized, so I opened a new draft of it with every answer and the follow-up carried over.";

describe("readDraftDelete", () => {
  it.each([
    ["delete that draft"],
    ["delete the draft"],
    ["discard it"],
    ["Delete the new draft please"],
    ["can you delete this draft"],
    ["ok, scrap that draft"],
    ["throw it away"],
    ["get rid of the draft"],
  ])('"%s" asks for the draft to be deleted', (words) => {
    expect(readDraftDelete(words, OPENED)).toBe(true);
  });

  it.each([
    ["delete the last sentence of the observation"],
    ["remove the late opening policy"],
    ["remove it"],
    ["delete that draft and start a new one for Sela Brandt"],
    ["how do I delete a draft?"],
  ])('"%s" is not a request to delete the draft', (words) => {
    expect(readDraftDelete(words, OPENED)).toBe(false);
  });

  it('"discard it" counts only when the previous answer was about a draft', () => {
    expect(readDraftDelete("discard it", "The Late Opening policy is on page 15.")).toBe(false);
  });
});

describe("readIncidentAnswer", () => {
  it.each([["same incideny"], ["same incident"], ["Same incident."], ["yes same one"], ["the same"], ["same"]])(
    '"%s" is the same incident',
    (words) => expect(readIncidentAnswer(words)).toBe("same"),
  );
  it.each([["different incident"], ["new incident"], ["a new one"], ["no, separate incident"]])(
    '"%s" is a different incident',
    (words) => expect(readIncidentAnswer(words)).toBe("different"),
  );
  it.each([["same as the coaching form for her"], ["she was late again"], ["new"]])('"%s" is neither', (words) =>
    expect(readIncidentAnswer(words)).toBeNull(),
  );
});

describe("incidentQuestionAsked", () => {
  it("reads the form and person the production answer asked about (conv_mvjo2bu22j9ms1q, name replaced)", () => {
    const asked = incidentQuestionAsked(
      "Worth flagging before you start a new one: on October 17 you already created a Corrective Action Form for Sela Brandt for opening late — and that one is still a draft. You also finalized two coaching forms for her dated 10/13.\n\nSo the question is whether this is the same incident or a new one:",
    );
    expect(asked).toMatchObject({ templateKey: "dpoa", employeeName: "Sela Brandt" });
  });

  it("an answer that asked no such question asks nothing", () => {
    expect(incidentQuestionAsked("The Corrective Action Form for Sela Brandt is still a draft.")).toBeNull();
  });

  it("a create payload with a 'different incident' answer to that question is a new incident", () => {
    const conversation = [
      { role: "user", content: "Write a CA for a TC Sela Brandt for opening the salon late" },
      { role: "assistant", content: "You already have a Corrective Action Form for Sela Brandt. Is this the same incident or a new one?" },
      { role: "user", content: "different incident" },
    ];
    expect(historySaysDifferentIncident(conversation)).toBe(true);
    expect(historySaysDifferentIncident(conversation.slice(0, 2))).toBe(false);
  });
});
