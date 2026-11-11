import { afterEach, describe, expect, it, vi } from "vitest";

import { rosterPosition, withCaJobTitleFromRoster } from "./ca-job-title-from-roster";
import type { DirectoryFact } from "./employee-roster";

/* CA_JOB_TITLE_FROM_ROSTER_ENABLED (QA, 11 Nov 2026, found on sf-b5). Invented people. */
const fact = (id: string, firstName: string, lastName: string, title: string | null) =>
  ({ id, firstName, lastName, preferredFirstName: null, locationIds: [], title, primaryLocationName: null, primarySalonId: null }) as unknown as DirectoryFact;
const FACTS = [fact("1", "Brisa", "Tolland", "Assistant Salon Director"), fact("2", "Remy", "Calder", "Tanning Consultant"), fact("3", "Remy", "Calder", "Salon Director")];
const read = async () => FACTS;
const card = (over: Record<string, unknown> = {}) => ({ formProposal: { templateKey: "dpoa", employeeName: "Brisa Tolland", employeeRole: null, ...over } });

afterEach(() => vi.unstubAllEnvs());

describe("CA_JOB_TITLE_FROM_ROSTER_ENABLED", () => {
  it("reads the one roster person's position; two people of one name with different titles give none", () => {
    expect(rosterPosition("brisa tolland", FACTS)).toBe("Assistant Salon Director");
    expect(rosterPosition("Remy Calder", FACTS)).toBeNull();
    expect(rosterPosition("Juno Paxton", FACTS)).toBeNull();
  });

  it("off: the card is as built", async () => {
    expect(await withCaJobTitleFromRoster(card(), null, read)).toEqual(card());
  });

  it("on: a CA card with no title takes the roster position; a stated title, another form or a team card is kept", async () => {
    vi.stubEnv("CA_JOB_TITLE_FROM_ROSTER_ENABLED", "true");
    expect((await withCaJobTitleFromRoster(card(), null, read)).formProposal.employeeRole).toBe("Assistant Salon Director");
    expect((await withCaJobTitleFromRoster(card({ employeeRole: "Lead" }), null, read)).formProposal.employeeRole).toBe("Lead");
    expect((await withCaJobTitleFromRoster(card({ templateKey: "coaching" }), null, read)).formProposal.employeeRole).toBeNull();
    expect((await withCaJobTitleFromRoster(card({ subject: "team" }), null, read)).formProposal.employeeRole).toBeNull();
  });
});
