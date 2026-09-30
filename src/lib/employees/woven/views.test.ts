import { describe, expect, it } from "vitest";

import { WOVEN_SAMPLE_DATASET } from "@/data/demo/woven";
import type { AccessPreviewRow, DirectoryRow } from "./view-types";
import {
  accessDrift,
  changeLabel,
  domainEligible,
  evaluateEligibility,
  matchesFilter,
  parseChangeQuery,
  parseDirectoryQuery,
  queryChanges,
  queryDirectory,
} from "./views";

/**
 * The tabs' rules, over the labelled sample set — which is exactly the shape
 * the real directory is read into, so these are the real rules.
 */

const rows = WOVEN_SAMPLE_DATASET.directory;
const byName = (name: string) => rows.find((r) => `${r.firstName} ${r.lastName}` === name)!;

describe("parseDirectoryQuery", () => {
  it("keeps known filters and drops unknown ones, malformed ids and silly pages", () => {
    const q = parseDirectoryQuery({ q: "  Jonah ", filter: ["active", "bogus", "active"], location: "../x", position: "SAMPLE-POS-03", page: "-3" });
    expect(q).toEqual({ search: "Jonah", status: null, filters: ["active"], locationId: null, positionId: "SAMPLE-POS-03", page: 1 });
  });

  it("reads the status dropdown: active, terminated or unknown; anything else is all statuses", () => {
    expect(parseDirectoryQuery({ status: "active" }).status).toBe("active");
    expect(parseDirectoryQuery({ status: "terminated" }).status).toBe("terminated");
    expect(parseDirectoryQuery({ status: "unknown" }).status).toBe("unknown");
    for (const bad of ["", "Active", "all", "past_termination_date", "terminated,active"]) {
      expect(parseDirectoryQuery({ status: bad }).status, bad).toBeNull();
    }
    expect(parseDirectoryQuery({ status: ["terminated", "active"] }).status).toBe("terminated");
  });
});

describe("the status dropdown", () => {
  it("filters on Woven's normalised status and keeps the other filters", () => {
    const terminated = queryDirectory(rows, parseDirectoryQuery({ status: "terminated" }));
    expect(terminated.rows.map((r) => `${r.firstName} ${r.lastName}`).sort()).toEqual(["Beatrix Mallory", "Delphine Harrow"]);
    expect(terminated.total).toBe(2);
    const active = queryDirectory(rows, parseDirectoryQuery({ status: "active" }));
    expect(active.total).toBe(rows.length - 2);
    expect(active.rows.every((r) => r.employmentStatus === "active")).toBe(true);
    /* Combined with search and a chip. */
    expect(queryDirectory(rows, parseDirectoryQuery({ status: "active", filter: ["multiple_locations"] })).total).toBe(
      queryDirectory(rows, parseDirectoryQuery({ filter: ["active", "multiple_locations"] })).total,
    );
    expect(queryDirectory(rows, parseDirectoryQuery({ status: "terminated", q: "brightwater" })).total).toBe(0);
  });

  it("counts every status across the whole directory, whatever is selected", () => {
    const counts = { active: rows.filter((r) => r.employmentStatus === "active").length, terminated: 2, unknown: rows.filter((r) => r.employmentStatus === "unknown").length };
    expect(queryDirectory(rows, parseDirectoryQuery({})).statusCounts).toEqual(counts);
    expect(queryDirectory(rows, parseDirectoryQuery({ status: "terminated", q: "zzz" })).statusCounts).toEqual(counts);
    /* The chips' counts are unchanged by the dropdown too. */
    expect(queryDirectory(rows, parseDirectoryQuery({ status: "terminated" })).filterCounts).toEqual(queryDirectory(rows, parseDirectoryQuery({})).filterCounts);
  });

  it("never reads a termination date as a status: an active employee with a past TerminationDate stays under Active", () => {
    const conflict: DirectoryRow = { ...byName("Jonah Brightwater"), employmentStatus: "active", terminationDate: "2024-08-01", dataIssues: ["status_termination_conflict"] };
    const set = [...rows.filter((r) => r.id !== conflict.id), conflict];
    expect(queryDirectory(set, parseDirectoryQuery({ status: "active" })).rows.some((r) => r.id === conflict.id)).toBe(true);
    expect(queryDirectory(set, parseDirectoryQuery({ status: "terminated" })).rows.some((r) => r.id === conflict.id)).toBe(false);
  });
});

describe("changeLabel: the history keeps its kind; the screen says what it means", () => {
  it("the initial import, a new hire and a newly visible employee read differently", () => {
    expect(changeLabel("new_employee", "initial_load")).toBe("Initial import");
    expect(changeLabel("new_employee", "new_hire")).toBe("New hire");
    expect(changeLabel("new_employee", "newly_visible")).toBe("New employee");
    expect(changeLabel("new_employee", null)).toBe("New employee");
  });

  it("every other kind has plain words, never the code", () => {
    expect(changeLabel("terminated", null)).toBe("Terminated");
    expect(changeLabel("position_changed", "unclassified")).toBe("Position changed");
    expect(changeLabel("primary_location_changed", "transfer")).toBe("Primary location changed");
    expect(changeLabel("missing_from_source", null)).toBe("Missing from Woven");
    for (const kind of ["new_employee", "terminated", "reactivated", "position_changed", "primary_location_changed", "location_access_added", "location_access_removed", "email_changed", "missing_from_source"] as const) {
      expect(changeLabel(kind, null)).not.toContain("_");
    }
  });
});

describe("the nine directory filters", () => {
  const names = (filter: Parameters<typeof matchesFilter>[1]) =>
    rows.filter((r) => matchesFilter(r, filter)).map((r) => `${r.firstName} ${r.lastName}`).sort();

  it("Active and Terminated", () => {
    expect(names("terminated")).toEqual(["Beatrix Mallory", "Delphine Harrow"]);
    expect(names("active")).toHaveLength(rows.length - 2);
  });

  it("New hire uses the classification, not merely 'first seen'", () => {
    expect(names("new_hire")).toEqual(["Marisol Quintero"]);
  });

  it("Position changed and Transfer", () => {
    expect(names("position_changed")).toEqual(["Jonah Brightwater", "Rosalind Okafor"]);
    expect(names("transfer")).toEqual(["Priyanka Sorensen"]);
  });

  it("Multiple locations counts additional, temporary-or-expiring and all-location access", () => {
    expect(names("multiple_locations")).toEqual(["Callum Ashdown", "Jonah Brightwater", "Odessa Farthing", "Theo Vantongeren"]);
  });

  it("Missing email, Unmapped position, Unmapped location", () => {
    expect(names("missing_email")).toEqual(["Ignatius Pell"]);
    expect(names("unmapped_position")).toEqual(["Odessa Farthing", "Rosalind Okafor"]);
    expect(names("unmapped_location").length).toBeGreaterThan(0);
  });
});

describe("queryDirectory", () => {
  it("searches name, email and Woven ID; combines filters; filters by any location", () => {
    expect(queryDirectory(rows, parseDirectoryQuery({ q: "brightwater" })).rows.map((r) => r.lastName)).toEqual(["Brightwater"]);
    expect(queryDirectory(rows, parseDirectoryQuery({ q: "SAMPLE-EMP-0005" })).rows.map((r) => r.lastName)).toEqual(["Ashdown"]);
    expect(queryDirectory(rows, parseDirectoryQuery({ filter: ["active", "multiple_locations"] })).total).toBe(4);
    const oak = queryDirectory(rows, parseDirectoryQuery({ location: "SAMPLE-LOC-104" }));
    expect(oak.rows.map((r) => r.lastName).sort()).toEqual(["Ashdown", "Brightwater", "Mallory", "Vantongeren"]);
  });

  it("pages, and counts every filter across the whole directory", () => {
    const page = queryDirectory(rows, parseDirectoryQuery({ page: "2" }), 5);
    expect(page.page).toBe(2);
    expect(page.rows).toHaveLength(5);
    expect(page.total).toBe(rows.length);
    expect(page.filterCounts.terminated).toBe(2);
    expect(queryDirectory(rows, parseDirectoryQuery({ page: "99" }), 5).page).toBe(3);
  });
});

describe("queryChanges", () => {
  it("filters by kind and review status, newest first, with counts per kind", () => {
    const page = queryChanges(WOVEN_SAMPLE_DATASET.changes, parseChangeQuery({ kind: "position_changed" }));
    expect(page.rows.map((r) => r.classification)).toEqual(["promotion_confirmed", "unclassified"]);
    expect(page.kindCounts.location_access_added).toBe(2);
    expect(queryChanges(WOVEN_SAMPLE_DATASET.changes, parseChangeQuery({ review: "dismissed" })).total).toBe(1);
    expect(parseChangeQuery({ kind: "work_email_changed" }).kind).toBeNull();
  });
});

describe("the eligibility preview", () => {
  const preview = WOVEN_SAMPLE_DATASET.accessPreview;
  const domains = WOVEN_SAMPLE_DATASET.loginEmailDomains;

  it("is always a preview", () => {
    expect(evaluateEligibility("marisol.quintero@sample-salons.test", preview, domains).previewOnly).toBe(true);
  });

  it("eligible: active, login domain, confirmed role, mapped salon, no login yet", () => {
    const r = evaluateEligibility("MARISOL.QUINTERO@sample-salons.test", preview, domains);
    expect(r.verdict).toBe("eligible");
    expect(r.employee).toMatchObject({ wouldCreateRole: "employee", wouldCreateScopeLevel: "salon", primarySalonNumber: "S101" });
  });

  it("not eligible: terminated, not in Woven, not an address, or not at a login domain", () => {
    expect(evaluateEligibility("delphine.harrow@sample-salons.test", preview, domains).verdict).toBe("not_eligible");
    expect(evaluateEligibility("nobody@sample-salons.test", preview, domains).verdict).toBe("not_eligible");
    expect(evaluateEligibility("nope", preview, domains).verdict).toBe("not_eligible");
    const personal = evaluateEligibility("wren.castellano@personal-mail.test", preview, domains);
    expect(personal.verdict).toBe("not_eligible");
    expect(personal.reasons.join(" ")).toMatch(/login-email domain/);
  });

  it("held for review: unconfirmed position, unmapped salon, or an existing login", () => {
    expect(evaluateEligibility("rosalind.okafor@sample-salons.test", preview, domains).verdict).toBe("held_for_review");
    expect(evaluateEligibility("theo.vantongeren@sample-salons.test", preview, domains).verdict).toBe("held_for_review");
    expect(evaluateEligibility("jonah.brightwater@sample-salons.test", preview, domains).reasons.join(" ")).toMatch(/already exists/);
  });

  it("with NO login domain configured, nobody is eligible", () => {
    const r = evaluateEligibility("marisol.quintero@sample-salons.test", preview, []);
    expect(r.verdict).toBe("not_eligible");
    expect(r.reasons.join(" ")).toMatch(/WOVEN_LOGIN_EMAIL_DOMAINS/);
  });

  it("holds a shared email for a person to resolve", () => {
    const dup: AccessPreviewRow[] = [preview[0], { ...preview[1], emailAddress: preview[0].emailAddress }];
    expect(evaluateEligibility(preview[0].emailAddress!, dup, domains).verdict).toBe("held_for_review");
  });

  it("domain matching is exact and case-insensitive", () => {
    expect(domainEligible("A@Sample-Salons.TEST", ["sample-salons.test"])).toBe(true);
    expect(domainEligible("a@evil-sample-salons.test", ["sample-salons.test"])).toBe(false);
    expect(domainEligible(null, ["sample-salons.test"])).toBe(false);
  });
});

describe("access drift", () => {
  it("lists exactly the people a later phase would act on", () => {
    const names = accessDrift(WOVEN_SAMPLE_DATASET.accessPreview).map((r) => r.employeeName).sort();
    expect(names).toContain("Delphine Harrow");
    expect(names).toContain("Jonah Brightwater");
    expect(names).toContain("Priyanka Sorensen");
    expect(names).toContain("Marisol Quintero");
    expect(names).not.toContain("Ignatius Pell");
  });
});

describe("the sample set is honest", () => {
  it("every id is SAMPLE-, every salon is a Sample Salon, every email a test domain", () => {
    const all = JSON.stringify(WOVEN_SAMPLE_DATASET);
    for (const r of rows as readonly DirectoryRow[]) {
      expect(r.externalEmployeeId.startsWith("SAMPLE-")).toBe(true);
      if (r.emailAddress) expect(r.emailAddress.endsWith(".test")).toBe(true);
    }
    expect(all).not.toMatch(/borrow/i);
    expect(WOVEN_SAMPLE_DATASET.label).toMatch(/^Sample data/);
    expect(byName("Theo Vantongeren").temporaryOrExpiringLocations[0].expiresOn).toBe("2026-10-12");
  });
});
