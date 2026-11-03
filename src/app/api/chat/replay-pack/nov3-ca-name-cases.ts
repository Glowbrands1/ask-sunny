import { expect } from "vitest";

import { KEARNEY, STAFF, type ReplayCase } from "./cases";

const WITH_CALDERON = [
  ...STAFF,
  { id: "e-calderon", firstName: "Remy", lastName: "Calderon", preferredFirstName: null, employmentStatus: "active", salonIds: ["loc-0309"], positionName: "Tanning Consultant" },
];

/** Pau, 3 Nov 2026: a Corrective Action's name is correctable from the chat. Invented people. */
export const NOV3_CA_NAME_CASES: readonly ReplayCase[] = [
  {
    id: "nov3-ca-name-from-chat",
    title: "\"fix her last name …\" on a Corrective Action changes the Employee Name, and says so",
    report: '"fix her last name …" on a Corrective Action: "The name on a Corrective Action Form isn\'t changed from the chat" (Pau: it should change)',
    status: { open: "CA_NAME_FROM_CHAT_ENABLED is off in production" },
    fixFlags: ["CA_NAME_FROM_CHAT_ENABLED"],
    async run(t) {
      t.directory(WITH_CALDERON);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("create a CA for Remy Calder for being late to opening this morning");
      expect(thread.proposal?.employeeName).toBe("Remy Calder");
      t.draftWrites({ observation: "Remy was late to opening this morning." });
      const id = await thread.create();
      const reply = await thread.say("fix her last name Calderon");
      expect(t.values(id).employee_name, "the Employee Name line").toBe("Remy Calderon");
      expect(t.forms().find((row) => row.id === id)?.employee_name, "the form's subject line").toBe("Remy Calderon");
      expect(reply.formUpdate?.updated ?? []).toContain("employee_name");
      expect(reply.content).toMatch(/Remy Calderon/);
    },
  },
  {
    id: "nov3-ca-name-not-on-roster",
    title: "a surname nobody on the roster has changes nothing, and the reply says so",
    report: "Pau, 3 Nov 2026: a different person's name is never written (roster-confirmed only)",
    status: "fixed",
    fixFlags: ["CA_NAME_FROM_CHAT_ENABLED"],
    async run(t) {
      t.directory(WITH_CALDERON);
      t.as("salon_director", KEARNEY);
      const thread = t.thread();
      await thread.say("create a CA for Remy Calder for being late to opening this morning");
      t.draftWrites({ observation: "Remy was late to opening this morning." });
      const id = await thread.create();
      const reply = await thread.say("fix her last name Okonkwo");
      expect(t.values(id).employee_name).toBe("Remy Calder");
      expect(reply.formUpdate).toBeUndefined();
      expect(reply.content).toMatch(/Nothing on the form has changed|haven't changed/);
    },
  },
];
