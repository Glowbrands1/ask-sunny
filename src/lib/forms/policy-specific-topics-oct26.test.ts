import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import rows from "@/test/fixtures/jba-manual-production-151.json";
import { accountManualSections } from "@/lib/ai/account-manual-sections";
import { formTurnCitations } from "@/lib/ai/form-card-slots";
import { manualChunkFromRow, type ChunkRow } from "@/lib/ai/full-manual-load";

import { describedManualSection } from "./named-policy-section";
import type { ManualChunk } from "./official-policy-manual";
import { manualSectionsFor, officialManualReference } from "./official-policy-manual";
import { OTHER_WRITE_IN_INSTRUCTION, specificTopic, withConductLinePage, withoutPrimedTopic } from "./specific-policy-topics";

/**
 * ============================================================================
 * THE SPECIFIC INCIDENT CITES ITS OWN SECTION (POLICY_SPECIFIC_TOPICS_ENABLED)
 * ============================================================================
 *
 * A live test, 26 Oct 2026, one manager sentence per incident ("create a ca
 * for <name> at dodge, ne. <incident>", names invented). Nearly all came back
 * Standards of Conduct, page 12. Pau's map of what each should cite is the
 * expectation here, read against the production JBA manual rows (printed
 * pages; the PDF sheet is printed + 1) so a moved heading is followed.
 *
 * Fails with the flag off (the page-12 answer) and passes with it on; the
 * cases Pau says are already right are pinned with the flag off AND on.
 */

const CHUNKS: readonly ManualChunk[] = (rows.chunks as ChunkRow[]).map(manualChunkFromRow);

afterEach(() => vi.unstubAllEnvs());
const on = () => vi.stubEnv("POLICY_SPECIFIC_TOPICS_ENABLED", "true");
const cited = (text: string) => accountManualSections(text, CHUNKS).map((section) => `${section.heading} p.${section.page}`);
/*
 * THE DRAFT ROUTE'S PATH for an account the Standards of Conduct is ticked for
 * (a direction not followed, Woven items, closing duties): the box's section
 * from the manual, then the page the manual prints for the listed infraction.
 */
const viaBox = (text: string, key: string) =>
  withConductLinePage(manualSectionsFor({ chunks: CHUNKS, offenseKeys: [key], notes: text }), text, CHUNKS).map(
    (section) => `${section.heading} p.${section.page}`,
  );
const ask = (incident: string) => `create a ca for Marisol Quade at dodge, ne. ${incident}`;

/* HOW MANAGERS TYPE: as written, all lowercase, sentence case, ALL CAPS. */
const lower = (text: string) => text.toLowerCase();
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
const upper = (text: string) => text.toUpperCase();
const registers = (text: string) => [text, lower(text), sentence(text), upper(text)];

const SAFETY = "Safety in the Workplace p.25";
const WET_SIGN = "Wet Floor Sign p.31";
const SOC13 = "Standards of Conduct p.13";

const EXPECTED: { name: string; incidents: string[]; cites: string[]; box?: string }[] = [
  {
    name: "no wet floor sign -> Safety in the Workplace p.25 (and the Wet Floor Sign it names p.31)",
    incidents: ["no wet floor sign", "Marisol mopped and did not put out a wet floor sign", "she left the floor wet, no wet flr sign out"],
    cites: [SAFETY, WET_SIGN],
  },
  {
    name: "a long break -> Meal and Rest Policy p.38",
    incidents: ["1 hour break", "took a 1 hour break", "took an hour lunch", "she took a 2 hr lunch", "took a 90 minute break"],
    cites: ["Meal and Rest Policy p.38"],
  },
  {
    name: "a social media post -> Social Media Policy p.22",
    incidents: ["instagram post about a guest", "posted a guest on her insta story", "she made a tiktok video of a client", "Facebook post about a customer"],
    cites: ["Social Media Policy p.22"],
  },
  {
    name: "a social media post at work -> Social Media Policy p.22 and Using Social Media at Work p.23",
    incidents: ["posted a guest on her insta story while on the clock", "instagram post about a guest during her shift"],
    cites: ["Social Media Policy p.22", "Using Social Media at Work p.23"],
  },
  {
    name: "sexual comments -> Sexual and Other Forms of Harassment p.9",
    incidents: ["sexual comments to a coworker", "made sexual jokes to a coworker", "sexually harassing a coworker", "harassment of a coworker", "sexual comments to a team member"],
    cites: ["Sexual and Other Forms of Harassment p.9"],
  },
  {
    name: "a pet -> Animals in the Workplace p.30 and Visitors in the Workplace p.29",
    incidents: ["brought her puppy in", "brought her pupy to work", "she brought her dog into the salon", "had her dog at work all day", "brought a pet in"],
    cites: ["Animals in the Workplace p.30", "Visitors in the Workplace p.29"],
  },
  {
    name: "took product -> Standards of Conduct p.13 and Handling Theft p.30",
    incidents: ["took product without paying", "took lotion without paying for it", "stole product", "she took 3 bottles home without paying", "theft of product"],
    cites: [SOC13, "Handling Theft p.30"],
  },
  {
    name: "a cash shortage -> Standards of Conduct p.13",
    incidents: ["cash handling", "drawer short", "drawer was short $20", "register short at close", "the till came up short"],
    cites: [SOC13],
    box: "standards_of_conduct",
  },
  {
    name: "refused / walked off -> Standards of Conduct p.13",
    incidents: ["refused to follow direction", "insubordination", "walked off the job", "she refused to clean the lobby when asked", "walked off her shift"],
    cites: [SOC13],
    box: "standards_of_conduct",
  },
  {
    name: "talking badly about coworkers -> Standards of Conduct p.13",
    incidents: ["talking bad about coworkers", "gossip about her coworkers", "negative talk about the team", "talking bad about her manager", "she was bad mouthing her coworkers"],
    cites: [SOC13],
  },
];

describe("flag off: the incident is not read (the bug: page 12 or nothing)", () => {
  it.each(EXPECTED.flatMap((entry) => entry.incidents.map((incident) => [entry.name, incident] as const)))("%s :: %s", (_name, incident) => {
    const text = ask(incident);
    expect(specificTopic(text)).toBeNull();
    expect(describedManualSection({ text, chunks: CHUNKS })?.section.heading ?? null).not.toBe("Sexual and Other Forms of Harassment");
    for (const heading of ["Meal and Rest Policy p.38", "Animals in the Workplace p.30", SAFETY, SOC13]) {
      expect(cited(text)).not.toContain(heading);
    }
  });
});

describe("flag on: every incident cites its own section, in every register", () => {
  for (const entry of EXPECTED) {
    describe(entry.name, () => {
      it.each(entry.incidents.flatMap(registers))("%s", (incident) => {
        on();
        if (entry.box) {
          expect(viaBox(ask(incident), entry.box)).toEqual(entry.cites);
          return;
        }
        expect(cited(ask(incident))).toEqual(expect.arrayContaining(entry.cites));
        // The primary citation leads, and Standards of Conduct page 12 is not cited beside it.
        expect(cited(ask(incident))[0]).toBe(entry.cites[0]);
        expect(cited(ask(incident))).not.toContain("Standards of Conduct p.12");
      });
    });
  }

  it("the reference line the form prints names the section and its printed page", () => {
    on();
    const sections = accountManualSections(ask("brought her puppy in"), CHUNKS);
    expect(officialManualReference("JBA Policy Manual", sections)).toContain("Animals in the Workplace — Page 30");
  });

  it("the chat card cites the same page whatever heading the model chose", () => {
    on();
    for (const modelHeading of ["Standards of Conduct", "Violation of Company Policies", null]) {
      const citations = formTurnCitations({
        notes: ask("drawer short"),
        chunks: CHUNKS,
        documentId: "manual",
        documentTitle: "JBA Policy Manual",
        modelHeading,
      });
      expect(citations.map((citation) => citation.locator)).toEqual(["Page 13"]);
    }
  });
});

describe("flag on: gossip and negative talk are the Standards of Conduct and NEVER Harassment", () => {
  it.each(
    [
      "gossip about her coworkers",
      "talking bad about coworkers",
      "negative talk about the team",
      "talking bad about a manager",
      "she was rude and disrespectful to her manager",
      "spreading rumors about a coworker",
    ].flatMap(registers),
  )("%s", (incident) => {
    on();
    expect(cited(ask(incident)).join("|")).not.toMatch(/harassment/i);
    expect(specificTopic(ask(incident))?.id).not.toBe("harassment");
  });

  it.each(["rude to a guest", "was rude to a customer at the front desk"].flatMap(registers))(
    "a guest treated rudely stays Standards of Conduct p.12, never p.13 (Pau confirmed); the card now carries it too: %s",
    (incident) => {
      expect(cited(ask(incident))).toEqual([]);
      expect(viaBox(ask(incident), "standards_of_conduct")).toEqual(["Standards of Conduct p.12"]);
      on();
      expect(cited(ask(incident))).toEqual(["Standards of Conduct p.12"]);
      expect(viaBox(ask(incident), "standards_of_conduct")).toEqual(["Standards of Conduct p.12"]);
    },
  );

  it.each(["talked bad about a guest"].flatMap(registers))("gossip about a guest is not the coworker line: %s", (incident) => {
    on();
    expect(cited(ask(incident))).not.toContain(SOC13);
  });
});

/* NEVER-BREAK PINS: the readings Pau confirmed are the same flag off and flag on. */
/* A late opening is Late Opening and not Attendance: the Tardiness box's sections, read as the draft reads them. */
const PINS: { name: string; incident: string; cites: string[]; box?: string }[] = [
  { name: "no call no show", incident: "Marisol Quade was a no call no show on 10-18-26.", cites: ["Attendance p.14"] },
  { name: "late", incident: "Marisol Quade was late on 10-18-26.", cites: ["Attendance p.14"] },
  { name: "left early", incident: "Marisol Quade left early on 10-18-26.", cites: ["Attendance p.14"] },
  { name: "missed meeting", incident: "Marisol Quade missed the monthly meeting on 10-20-26.", cites: ["Attendance p.14"] },
  { name: "late opening", incident: "Marisol Quade had a late opening on 10-18-26.", cites: ["Late Opening p.15"], box: "tardiness" },
  { name: "missed Woven deadline", incident: "Marisol Quade missed the Woven deadline.", cites: ["Standards of Conduct p.12"] , box: "standards_of_conduct" },
  { name: "Woven acknowledgements", incident: "Marisol Quade did not complete the woven policy acknowledgements.", cites: ["Standards of Conduct p.12"] , box: "standards_of_conduct" },
  { name: "refused the Woven training", incident: "Marisol Quade refused to complete her woven training.", cites: ["Standards of Conduct p.12"] , box: "standards_of_conduct" },
  { name: "dress code", incident: "Marisol Quade was wearing slippers on the floor.", cites: ["Dress Code for The Company p.15"] , box: "dress_code" },
  { name: "cell phone", incident: "Marisol Quade was talking on her cell phone for over 30 minutes.", cites: ["Cell Phone/Smart Watch Policy p.19"] },
  { name: "closing duties", incident: "Marisol Quade's closing duties weren't done on 10-18-26.", cites: ["Standards of Conduct p.12"] , box: "standards_of_conduct" },
  { name: "sales below goal", incident: "Marisol Quade's sales were below goal this month.", cites: [] },
];

describe("never break: Pau's confirmed readings, flag off AND on", () => {
  it.each(PINS.flatMap((pin) => registers(pin.incident).map((text) => [pin.name, text, pin.cites, pin.box ?? null] as const)))(
    "%s :: %s",
    (_name, text, cites, box) => {
      const read = () => (box ? viaBox(text, box) : cited(text));
      const before = read();
      // Leads with the confirmed section (a late opening may list Attendance after it, as on main); no policy for sales.
      expect(cites.length === 0 ? before : before.slice(0, cites.length)).toEqual(cites);
      on();
      expect(read()).toEqual(before);
      vi.unstubAllEnvs();
    },
  );
});

describe("flag on: not an account of the incident", () => {
  it.each([
    "What is the animals in the workplace policy?",
    "Marisol Quade cleaned the break room.",
    "Marisol Quade worked a full shift and took her normal break.",
    "Marisol Quade shared a post from the company page.",
  ])("%s", (text) => {
    on();
    expect(specificTopic(text)).toBeNull();
  });
});

describe("the coaching form's other topic is not primed with Punctuality (POLICY_SPECIFIC_TOPICS_ENABLED)", () => {
  const cellPhone = "coaching for Marisol Quade at dodge, ne. she was on her cell phone for over 30 minutes";

  it("off: the route still shows Punctuality in its prompt and the value stands (the bug)", () => {
    expect(readFileSync("src/app/api/forms/instances/[id]/draft/route.ts", "utf8")).toContain('for lateness that write-in is "Punctuality"');
    expect(withoutPrimedTopic({ other_topic: "Punctuality" }, cellPhone)).toEqual({ other_topic: "Punctuality" });
  });

  it("on: the prompt names no example and a Punctuality nobody described is dropped", () => {
    on();
    expect(OTHER_WRITE_IN_INSTRUCTION).not.toContain("Punctuality");
    expect(withoutPrimedTopic({ other_topic: "Punctuality", coaching_details: "x" }, cellPhone)).toEqual({ coaching_details: "x" });
  });

  it.each(["she was late on 10-18-26", "She arrived 20 minutes late", "left early twice this week", "No call no show on friday"])(
    "on: lateness keeps Punctuality: %s",
    (account) => {
      on();
      expect(withoutPrimedTopic({ other_topic: "Punctuality" }, account)).toEqual({ other_topic: "Punctuality" });
    },
  );

  it("on: another topic the model wrote is left alone", () => {
    on();
    expect(withoutPrimedTopic({ other_topic: "Cell phone use" }, cellPhone)).toEqual({ other_topic: "Cell phone use" });
  });
});

/*
 * THE COACHING / CHAT CARD carries the same policy a Corrective Action does
 * (QA live test: coaching cards for conduct incidents came back blank or with
 * the nearest text, Attendance p.14 for closing duties). Off, as before.
 */
describe("flag on: a conduct incident the reading points at cites the Standards of Conduct on the card", () => {
  const CONDUCT = [
    ["did not complete her closing checklist on 10-18-26", "Standards of Conduct p.12"],
    ["did not complete the woven policy acknowledgements", "Standards of Conduct p.12"],
    ["missed the woven deadline", "Standards of Conduct p.12"],
    ["refused to follow direction", SOC13],
    ["insubordination", SOC13],
  ] as const;

  it.each(CONDUCT.flatMap(([incident, cite]) => registers(incident).map((text) => [text, cite] as const)))("%s", (incident, cite) => {
    const before = cited(ask(incident));
    expect(before).not.toContain(cite);
    on();
    expect(cited(ask(incident))).toEqual([cite]);
  });
});
