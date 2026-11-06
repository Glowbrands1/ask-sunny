import { expect, vi } from "vitest";

import { KEARNEY, STAFF, type DirectoryRow, type ReplayCase, type ReplayContext } from "./cases";

/**
 * ============================================================================
 * PAU'S sf-s26, sf-s27, sf-s28 (Ask Sunny production, relayed by QA, 5 Nov
 * 2026): names and chat flow
 * ============================================================================
 *
 * Cases only: OPEN with today's production flags, no fixFlags until a fix
 * exists. The manager's turns are verbatim; "Employee R" is invented
 * (Thessaly Brandt; "Thesaly Brant" for the misspelling). The manager is the
 * actor.
 *
 *   sf-s26  "Edit [misspelled Employee R] CA" asked who the form is for; in a
 *           new chat "Change Employee R CA" started a new form ("You haven't
 *           told me what happened yet"). Expected: the existing CA opens for
 *           editing.
 *   sf-s27  "Create a coaching form." → "Employee R" → "Everything I need is
 *           here … I have the employee and the salon." with no incident.
 *           Expected: it asks what happened; never says it is ready.
 *   sf-s28  "can i give a ca for not signing off on the cleaning check list" →
 *           "can you write me a ca for Employee R from o street" → "You
 *           haven't told me what happened yet", and the Observation was the
 *           question. Expected: the previous turn's incident is used.
 */

type T = ReplayContext;

const THESSALY: DirectoryRow = {
  id: "e-thessaly-brandt",
  firstName: "Thessaly",
  lastName: "Brandt",
  preferredFirstName: null,
  employmentStatus: "active",
  salonIds: ["loc-0309"],
  positionName: "Tanning Consultant",
};

/** The invented person of this file (a function: the registry reads exported arrays as cases). */
export function pauSfS26S28People(): readonly DirectoryRow[] {
  return [THESSALY];
}

const READY = /Everything I need is here|I have the employee/i;
const ASKS_WHAT = /what happened|tell me (?:more )?(?:about )?what|haven't told me what happened/i;
const NO_ACCOUNT = /haven't told me what happened yet/i;
const ASKS_WHO = /Who is this (?:\*\*[^*]+\*\* |form )?for\?/i;

function start(t: T) {
  vi.setSystemTime(new Date("2026-11-05T15:00:00Z"));
  t.directory([...STAFF, THESSALY]);
  t.as("salon_director", KEARNEY);
}

/** A Corrective Action already on file for Thessaly Brandt (made in an earlier chat). */
async function existingCa(t: T): Promise<string> {
  const earlier = t.thread();
  await earlier.say("I need a corrective action for Thessaly Brandt, she was late opening the salon on Monday");
  t.draftWrites({ observation: "Observed:\nThessaly Brandt opened the salon late on Monday." });
  return earlier.create();
}

export const NOV5_PAU_SF_S26_S28_CASES: ReplayCase[] = [
  {
    id: "nov5-sf-s26-edit-misspelled-ca",
    title: "sf-s26: \"Edit Thesaly Brant CA\" (misspelled) opens Thessaly Brandt's existing Corrective Action; never \"Who is this form for?\"",
    report: "Pau via QA, 5 Nov 2026, sf-s26: \"Edit [misspelled Employee R] CA\" → the bot asked who the form is for",
    status: { open: "asks who the form is for instead of opening the existing Corrective Action" },
    async run(t: T) {
      start(t);
      const id = await existingCa(t);
      const reply = await t.thread().say("Edit Thesaly Brant CA");
      expect(reply.content, `asks who instead of opening the CA on file:\n${reply.content}`).not.toMatch(ASKS_WHO);
      expect(reply.formOpened?.instanceId, `the existing Corrective Action is not opened:\n${reply.content}`).toBe(id);
    },
  },
  {
    id: "nov5-sf-s26-change-ca-new-chat",
    title: "sf-s26: in a new chat, \"Change Thessaly Brandt CA\" opens her existing Corrective Action; never a new form \"You haven't told me what happened yet\"",
    report: "Pau via QA, 5 Nov 2026, sf-s26: in a new chat \"Change Employee R CA\" → a new form, \"You haven't told me what happened yet\"",
    status: { open: "starts a new Corrective Action instead of opening the one on file" },
    // REOPEN_BY_ANY_OPEN_VERB_ENABLED (QA, 6 Nov 2026): "CA" after the name is read as the Corrective Action Form.
    fixFlags: ["REOPEN_BY_ANY_OPEN_VERB_ENABLED"],
    async run(t: T) {
      start(t);
      const id = await existingCa(t);
      const reply = await t.thread().say("Change Thessaly Brandt CA");
      expect(reply.content, `a new form is started:\n${reply.content}`).not.toMatch(NO_ACCOUNT);
      expect(reply.formOpened?.instanceId, `the existing Corrective Action is not opened:\n${reply.content}`).toBe(id);
    },
  },
  {
    id: "nov5-sf-s27-coaching-name-only-asks-what-happened",
    title: "sf-s27: \"Create a coaching form.\" → \"Thessaly Brandt\": asks what happened; never \"Everything I need is here\"",
    report: "Pau via QA, 5 Nov 2026, sf-s27: \"Create a coaching form.\" → \"Employee R\" → \"Everything I need is here … I have the employee and the salon.\" with no incident",
    status: { open: "says \"Everything I need is here … I have the employee and the salon.\" with no incident" },
    fixFlags: ["COACHING_ASKS_WHAT_HAPPENED_ENABLED"],
    async run(t: T) {
      start(t);
      const thread = t.thread();
      await thread.say("Create a coaching form.");
      const reply = await thread.say("Thessaly Brandt");
      expect(reply.content, `says it is ready with no incident:\n${reply.content}`).not.toMatch(READY);
      expect(reply.content, `does not ask what happened:\n${reply.content}`).toMatch(ASKS_WHAT);
    },
  },
  {
    id: "nov5-sf-s28-incident-from-previous-turn",
    title: "sf-s28: \"can i give a ca for not signing off on the cleaning check list\" → \"can you write me a ca for Thessaly Brandt from o street\": the card uses the earlier incident",
    report:
      "Pau via QA, 5 Nov 2026, sf-s28: \"can i give a ca for not signing off on the cleaning check list\" → \"can you write me a ca for Employee R from o street\" → \"You haven't told me what happened yet\", the Observation was the question",
    status: { open: "\"You haven't told me what happened yet\"; the earlier turn's incident is not used" },
    fixFlags: ["OMISSION_IS_ACCOUNT_ENABLED", "OBSERVATION_WITHOUT_ASK_ENABLED"],
    async run(t: T) {
      /*
       * CA_ASKS_WHAT_HAPPENED_ENABLED is on in production (QA, 5 Nov 2026; in
       * production-flags.json's assumedOn with #532). It writes the "You
       * haven't told me what happened yet" this case reports, so it is on here
       * whatever this file's main lists.
       */
      vi.stubEnv("CA_ASKS_WHAT_HAPPENED_ENABLED", "true");
      try {
        start(t);
        const thread = t.thread();
        await thread.say("can i give a ca for not signing off on the cleaning check list");
        const reply = await thread.say("can you write me a ca for Thessaly Brandt from o street");
        expect(reply.content, `the earlier turn's incident is not used:\n${reply.content}`).not.toMatch(NO_ACCOUNT);
        expect(reply.content, `the question is the Observation:\n${reply.content}`).not.toMatch(/Observation[^\n]*can you write me/i);
        // Pau's "the Observation was the question": the earlier question is no Observation either; its incident is.
        expect(reply.content, `the earlier question is the Observation:\n${reply.content}`).not.toMatch(/Observation[^\n]*can i give/i);
        expect(thread.proposal, `no Corrective Action card for Thessaly Brandt:\n${reply.content}`).toMatchObject({ templateKey: "dpoa", employeeName: "Thessaly Brandt" });
      } finally {
        vi.unstubAllEnvs();
      }
    },
  },
];
