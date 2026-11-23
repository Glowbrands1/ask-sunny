import { describe, expect, it } from "vitest";

import type { ChatMessage } from "@/types";
import { formKey, whichFormChoice, whichFormEntry, type WhichFormRecord } from "./which-form";

/*
 * QA's Bubbles live re-run (22 Nov 2026, A11): T1 "bring up a previously edited corrective action for <P>" listed three
 * revised Corrective Actions (all 11/14) and asked which one; T2 "this is a verbal warning. previous coaching policy
 * manual 10-15-26" picked none, and the loop opened one anyway.
 */
const forms = [
  { instance_id: "f-1", form: "Corrective Action Form", status: "finalized", form_date: "2026-11-14", salon: "Omaha West Dodge" },
  { instance_id: "f-2", form: "Corrective Action Form", status: "finalized", form_date: "2026-11-14", salon: "Maple Plaza" },
  { instance_id: "f-3", form: "Corrective Action Form", status: "draft", form_date: "2026-11-13", salon: "Omaha West Dodge" },
];
const asked: WhichFormRecord = { forms: forms.map(whichFormEntry), messageId: "m1" };
const history: ChatMessage[] = [
  { id: "m1", role: "user", content: "bring up a previously edited corrective action for Fenna Prewitt" } as ChatMessage,
  { id: "a1", role: "assistant", content: "Which one should I open?" } as ChatMessage,
];
const choose = (id: string, question: string, quote?: string) =>
  whichFormChoice({ asked, instanceId: id, evidence: quote === undefined ? undefined : { message_id: "m2", quote }, history, question, questionMessageId: "m2" });

describe("whichFormChoice (A11)", () => {
  it("changes instead of a pick never open a listed form", () => {
    const t2 = "this is a verbal warning. previous coaching policy manual 10-15-26";
    expect(choose("f-1", t2)).toMatchObject({ ok: false, reason_code: "which_form_not_chosen" });
    expect(choose("f-1", t2, "this is a verbal warning")).toMatchObject({ ok: false, reason_code: "which_form_not_chosen" });
    expect(choose("f-1", t2, "10-15-26")).toMatchObject({ ok: false });
  });

  it("a fact only this form has picks it: its salon, its date, its status, its number in the list", () => {
    expect(choose("f-2", "the maple plaza one", "the maple plaza one")).toEqual({ ok: true });
    expect(choose("f-3", "the 11/13 one", "11/13")).toEqual({ ok: true });
    expect(choose("f-3", "open the draft", "the draft")).toEqual({ ok: true });
    expect(choose("f-2", "number 2", "number 2")).toEqual({ ok: true });
  });

  it("a fact every listed form shares picks none; a quote not in this message picks none", () => {
    expect(choose("f-1", "the corrective action form", "corrective action form")).toMatchObject({ ok: false });
    expect(choose("f-2", "something else", "the maple plaza one")).toMatchObject({ ok: false });
  });

  it("no open question, or a form not in the list: not this check's to refuse", () => {
    expect(whichFormChoice({ asked: null, instanceId: "f-1", evidence: undefined, history, question: "x" })).toEqual({ ok: true });
    expect(choose("f-9", "this is a verbal warning")).toEqual({ ok: true });
    expect(formKey("F-1")).toBe(formKey("f-1"));
  });
});

describe("whichFormChoice: a date typed as eight digits (a live manager's \"11202026\", Pau's review, 23 Nov 2026)", () => {
  const exits = [
    { instance_id: "x-1", form: "Resignation/Exit Form", status: "finalized", form_date: "2026-11-20", salon: "NE Kearney" },
    { instance_id: "x-2", form: "Resignation/Exit Form", status: "finalized", form_date: "2026-10-02", salon: "NE Kearney" },
  ];
  const listed: WhichFormRecord = { forms: exits.map(whichFormEntry), messageId: "m1" };
  const pick = (id: string, said: string) => whichFormChoice({ asked: listed, instanceId: id, evidence: { message_id: "m2", quote: said }, history, question: said, questionMessageId: "m2" });

  it("\"11202026\" picks the form dated 11/20/2026, and only it", () => {
    expect(pick("x-1", "11202026")).toEqual({ ok: true });
    expect(pick("x-2", "11202026")).toMatchObject({ ok: false, reason_code: "which_form_not_chosen" });
  });

  it("eight digits that are no calendar date pick nothing", () => {
    expect(pick("x-1", "13202026")).toMatchObject({ ok: false });
    expect(pick("x-1", "11312026")).toMatchObject({ ok: false });
  });
});
