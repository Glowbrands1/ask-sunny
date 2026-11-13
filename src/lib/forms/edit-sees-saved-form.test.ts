import { describe, expect, it } from "vitest";

import { SAVED_CHECK_HEADING, SAVED_CHECK_MAX_PATCHES, savedCheckBlock, settledByCode, touchedKeys } from "./edit-sees-saved-form";
import { buildFormPatchUserMessage, type FormPatchInput } from "./form-patch-prompt";

const INPUT: FormPatchInput = {
  today: "2026-11-13",
  templateName: "Coaching Form",
  employeeName: "Marnie Quill",
  fields: [{ key: "details", label: "Details of Coaching", kind: "text", filledBy: "assistant", value: "Observed:\nLate to open." }],
  readOnly: [],
  turns: [],
  latest: "add that she must clock in on time",
};

describe("EDIT_SEES_SAVED_FORM_ENABLED: the saved-form check block", () => {
  it("holds only keys, labels, stored values, whether this turn changed them, and the manager's ask", () => {
    const block = savedCheckBlock("add that she must clock in on time", [
      { key: "details", label: "Details of Coaching", stored: "Observed:\nLate to open.\nShe must clock in on time.", changed: true },
      { key: "coaching_type", label: "Type", stored: ["attendance"], changed: false },
    ]);
    expect(block.split("\n")[0]).toContain(SAVED_CHECK_HEADING);
    expect(block).toContain("details | Details of Coaching | changed this turn | Observed: / Late to open. / She must clock in on time.");
    expect(block).toContain("coaching_type | Type | not changed | attendance");
    expect(block).toContain("THE MANAGER ASKED: add that she must clock in on time");
  });

  it("goes just before the latest message, so the reading's own layout is unchanged around it", () => {
    const block = savedCheckBlock(INPUT.latest, []);
    const message = buildFormPatchUserMessage({ ...INPUT, savedCheck: block });
    const lines = message.split("\n");
    expect(lines.at(-1)).toBe(`LATEST MESSAGE FROM THE MANAGER: ${INPUT.latest}`);
    expect(message.indexOf(SAVED_CHECK_HEADING)).toBeGreaterThan(message.indexOf("CONVERSATION"));
  });

  it("is absent from every first reading: the message is byte for byte as before", () => {
    expect(buildFormPatchUserMessage(INPUT)).not.toContain(SAVED_CHECK_HEADING);
    expect(buildFormPatchUserMessage({ ...INPUT, savedCheck: undefined })).toBe(buildFormPatchUserMessage(INPUT));
  });

  it("names each touched field once, set and clear, and allows three patches a turn", () => {
    expect(touchedKeys({ set: { details: "x", other: "y" }, clear: ["details", "other_text"] })).toEqual(["details", "other", "other_text"]);
    expect(SAVED_CHECK_MAX_PATCHES).toBe(3);
  });
});

describe("EDIT_SEES_SAVED_FORM_ENABLED: settled by code (QA's speed change)", () => {
  const base = {
    ask: "add that she must clock in on time",
    employeeName: "Marnie Quill",
    fields: [{ key: "details", label: "Details", stored: "Observed:\nLate to open.\nShe must clock in on time.", changed: true }],
    patch: { how: { details: "add" }, evidence: { details: "she must clock in on time" } },
    stored: { details: "Observed:\nLate to open.\nShe must clock in on time.", form_date: "2026-11-13" },
    moved: ["details"],
  };
  it("a single-field edit the saved form plainly holds: settled, no model call", () => {
    expect(settledByCode(base)).toEqual({ settled: true, reason: "code" });
  });
  it("the writer's derived lines may move too", () => {
    expect(settledByCode({ ...base, moved: ["details", "action_plan", "policy_violated"] }).settled).toBe(true);
  });
  it("for the model: a free-text rewrite (the old path's revision, or a reword)", () => {
    // Changed on purpose (QA's reason breakdown, 13 Nov 2026): the old path's revision of a plain add ("add that …") is
    // settled by code now; a revision that rewrites ("make it about …", "more professional") stays the model's.
    expect(settledByCode({ ...base, patch: null }).reason).toBe("code");
    expect(settledByCode({ ...base, patch: null, ask: "make it about showing up late" }).reason).toBe("rewrite");
    expect(settledByCode({ ...base, ask: "can you make it more professional" }).reason).toBe("rewrite");
    expect(settledByCode({ ...base, patch: { how: { details: "reword" }, evidence: base.patch.evidence } }).reason).toBe("rewrite");
  });
  it("for the model: a touched field that did not change, a quoted word not stored, another field moved", () => {
    expect(settledByCode({ ...base, fields: [{ ...base.fields[0]!, changed: false }] }).reason).toBe("not_changed");
    expect(settledByCode({ ...base, stored: { ...base.stored, details: "Observed:\nLate to open." } }).reason).toBe("words_missing");
    expect(settledByCode({ ...base, moved: ["details", "form_date"] }).reason).toBe("other_moved");
  });
  it("for the model: a word of the ask on no field (\"… and the other topic is missed monthly meeting\")", () => {
    expect(settledByCode({ ...base, ask: "add that she must clock in on time, and the other topic is missed monthly meeting" }).reason).toBe("ask_not_on_form");
  });
});

describe("EDIT_SEES_SAVED_FORM_ENABLED: the code settle, widened after QA's reason breakdown (13 Nov 2026)", () => {
  const base = {
    ask: "add that she must clock in on time",
    employeeName: "Marnie Quill",
    fields: [{ key: "details", label: "Details", stored: "Observed:\nLate to open.\nShe must clock in on time.", changed: true }],
    patch: { set: { details: "She must clock in on time." }, how: { details: "add" }, evidence: { details: "she must clock in on time" } },
    stored: { details: "Observed:\nLate to open.\nShe must clock in on time.", form_date: "2026-11-13" },
    moved: ["details"],
  };
  it("a word that names a field (\"details\", or a typo of one) is not content", () => {
    expect(settledByCode({ ...base, ask: "add to the details that she must clock in on time", fieldWords: { details: ["Details of Coaching"] } }).settled).toBe(true);
    expect(settledByCode({ ...base, ask: "add to the observtion that she must clock in on time", fieldWords: { details: ["Observation of Offense"] } }).settled).toBe(true);
  });
  it("a word that names a field NOBODY wrote stays the model's (\"…and the other topic is missed monthly meeting\")", () => {
    const fieldWords = { details: ["Details of Coaching"], other_topic: ["Other topic"], coaching_topics: ["Topics", "other"] };
    const ask = "add that she must clock in on time, and the other topic is missed monthly meeting";
    const stored = { ...base.stored, details: `${base.stored.details}\nShe missed the monthly meeting.` };
    expect(settledByCode({ ...base, ask, stored, fieldWords }).reason).toBe("names_unwritten_field");
  });
  it("a touched field that already held what was asked needed no change", () => {
    const topics = { key: "coaching_topics", label: "Topics", stored: ["other"], changed: false };
    expect(settledByCode({ ...base, fields: [...base.fields, topics], patch: { ...base.patch, set: { ...base.patch.set, coaching_topics: ["other"] } }, stored: { ...base.stored, coaching_topics: ["other"] } }).settled).toBe(true);
  });
  it("the Date may move when the ask says a date", () => {
    expect(settledByCode({ ...base, ask: "add that she must clock in on time from 11/14", moved: ["details", "form_date"] }).settled).toBe(true);
    expect(settledByCode({ ...base, moved: ["details", "form_date"] }).reason).toBe("other_moved");
  });
  it("still for the model: a content word of the ask on no field", () => {
    expect(settledByCode({ ...base, ask: "add that she must clock in on time and wash the sink between guests" }).reason).toBe("ask_not_on_form");
  });
});
