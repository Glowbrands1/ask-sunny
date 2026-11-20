import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";
import { evidenceFrom, lastResult, loopStandIn, type LoopDecision } from "./loop-stand-in";

/**
 * ============================================================================
 * READ_FORM ON A LONG WRITE-UP KEEPS EVERY FIELD'S FILLED / EMPTY STATUS (QA's code audit on d7960a5f, item 26)
 * ============================================================================
 *
 * read_form stopped at 6,000 characters with `break`, and built empty_fields from what it had kept: on a Corrective
 * Action whose Observation runs past ~6,000 characters, the level and payroll after it read as EMPTY, so the model asked
 * again or said "the level isn't set". The rows also came back in no fixed order. General rule: a long field's text is
 * cut (truncated_fields names it), every filled field is still listed with its value, empty_fields lists only fields that
 * really are empty, and the values come in the template's order. Invented names only (Remy Calder).
 */

const FLAG = "AGENT_LOOP_ENABLED";
const REPORT = "QA's code audit on d7960a5f (item 26): read_form on a long write-up read the level and payroll as empty";
const offline = process.env.AGENT_LOOP_LIVE !== "1";

type ReadOut = { values?: Record<string, { untrusted_text: string }>; empty_fields?: string[]; truncated_fields?: string[] };

export const NOV20_AGENT_LOOP_READ_FORM_LONG_FIELD_CASES: ReplayCase[] = [
  {
    id: "nov20-read-form-long-observation-keeps-level-and-payroll",
    title: "Item 26: a Corrective Action draft with an Observation of ~8,000 characters, Written and payroll Yes ticked: read_form lists warning_type and payroll_deduct with their values, never in empty_fields, and names observation as truncated",
    report: REPORT,
    status: "fixed",
    fixFlags: [FLAG],
    async run(t) {
      if (!t.loopOn?.() || !offline) return;
      vi.setSystemTime(new Date("2026-11-14T22:40:00Z"));
      t.directory([...STAFF]);
      t.as("salon_director", KEARNEY);
      const first = "ca for remy calder, she was late to open on 11/12, written warning, yes payroll";
      t.loopModel!(loopStandIn((view): LoopDecision => (lastResult(view, "propose_form")
        ? { text: "Here's the card." }
        : { tool: "propose_form", input: { template_key: "dpoa", employee_id: "e-2", what_happened: "Remy Calder was late to open on 11/12.", incident_date: "2026-11-12", warning_level: "written", level_evidence: evidenceFrom(view, "written warning"), payroll_deduct: "yes", payroll_evidence: evidenceFrom(view, "yes payroll") } })));
      const thread = t.thread();
      await thread.say(first);
      const id = await thread.create();
      expect(t.checked(id).warning_type, "the draft holds no level (the case proves nothing)").toEqual(["written"]);
      const long = Array.from({ length: 160 }, (_, index) => `Line ${index + 1}: she was late to open and the lobby lights stayed off.`).join(" ");
      expect(long.length).toBeGreaterThan(7_000);
      t.typeOnForm(id, { observation: long });
      const model = loopStandIn((view): LoopDecision => (lastResult(view, "read_form")
        ? { text: "Read it." }
        : { tool: "read_form", input: { instance_id: id } }));
      t.loopModel!(model);
      await thread.say("what level is on her draft?");
      const read = lastResult(model.views.at(-1)!, "read_form") as ReadOut;
      expect(read.values?.warning_type?.untrusted_text, `the level read as missing:\n${JSON.stringify({ empty: read.empty_fields, keys: Object.keys(read.values ?? {}) })}`).toBe("written");
      expect(read.values?.payroll_deduct?.untrusted_text).toBe("yes");
      expect(read.empty_fields ?? [], "a filled field is listed as empty").not.toEqual(expect.arrayContaining(["warning_type"]));
      expect(read.empty_fields ?? []).not.toContain("payroll_deduct");
      expect(read.empty_fields ?? []).not.toContain("observation");
      expect(read.truncated_fields).toEqual(["observation"]);
      expect((read.values?.observation?.untrusted_text ?? "").length, "the long field was not cut").toBeLessThan(long.length);
    },
  },
];
