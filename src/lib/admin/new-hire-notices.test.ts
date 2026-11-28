import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  additionalSalons,
  eventPayload,
  hireRecipients,
  inviteSentText,
  isRecentHire,
  newHireNoticeText,
  readNewHireNoticeConfig,
  terminationNoticeText,
  windowStart,
  NEW_HIRE_NOTICE_HREF,
  NEW_HIRE_NOTICE_KIND,
  TERMINATION_NOTICE_KIND,
  type HiredEmployee,
} from "./new-hire-notices";
import { announceInviteSent, announceNewHires, eventKey, type NewHireNoticeDeps } from "./new-hire-notices.server";

/*
 * Pau, 28 Nov 2026:
 *   "create a notification when a new person is onboarded like a manager, assistant etc. for admins only for now
 *    backfill it when creating the notification that a new employee [name] , email address in woven has been hired as X
 *    position in X salon , and list if they have any other additional salon"
 *   "admin, owner and developer, also can you add if that person is in any salon the manager there will get notified
 *    too, also add coleen for this notification coz she is HR all hires and all terminated"
 *   "backfill only 2 weeks pls"
 *   "can you also send me a notification in my personal email … when someone join and get terminated and if we they
 *    get the link"
 *
 * Invented people, salons and addresses only (CLAUDE.md §2).
 */

const NOW = new Date("2026-11-28T15:00:00Z");
const HR = "hr.lead@example.com";
const HOOK = "https://n8n.example.com/webhook/woven-events";
const ON = { NEW_HIRE_NOTICES_ENABLED: "true", WOVEN_HR_NOTIFY_EMAILS: HR };
const WITH_HOOK = { ...ON, WOVEN_EVENTS_WEBHOOK_URL: HOOK, WOVEN_EVENTS_WEBHOOK_SECRET: "s3cret" };

const hire = (id: string, over: Partial<HiredEmployee> = {}): HiredEmployee => ({
  externalEmployeeId: id,
  firstName: "Robin",
  lastName: "Quillfeather",
  preferredFirstName: null,
  emailAddress: "robin.quillfeather@example.com",
  employmentStatus: "active",
  hireDate: "2026-11-24",
  positionName: "Salon Director",
  primaryLocationId: "L1",
  primaryLocationName: "Maple Grove",
  locations: [{ wovenLocationId: "L1", locationName: "Maple Grove", locationNumber: "101", accessType: "primary", expiresOn: null, areaId: "loc-101" }],
  ...over,
});

const twoSalons = (id: string, over: Partial<HiredEmployee> = {}) =>
  hire(id, {
    positionName: "Assistant Salon Director",
    locations: [
      { wovenLocationId: "L1", locationName: "Maple Grove", locationNumber: "101", accessType: "primary", expiresOn: null, areaId: "loc-101" },
      { wovenLocationId: "L3", locationName: "Cedar Point", locationNumber: "103", accessType: "additional", expiresOn: null, areaId: "loc-103" },
      { wovenLocationId: "L2", locationName: "Birch Hollow", locationNumber: "102", accessType: "temporary_or_expiring_access", expiresOn: "2026-12-15", areaId: "loc-102" },
      { wovenLocationId: "L3", locationName: "Cedar Point", locationNumber: "103", accessType: "additional", expiresOn: null, areaId: "loc-103" },
    ],
    ...over,
  });

describe("the words", () => {
  it("a hire: the name, the Woven email, the position, the salon, and that there are no other salons", () => {
    expect(newHireNoticeText(hire("E1"))).toEqual({
      title: "New hire: Robin Quillfeather — Salon Director",
      body: "New employee Robin Quillfeather, robin.quillfeather@example.com in Woven, has been hired as Salon Director at Maple Grove on Nov 24, 2026. No additional salons.",
    });
  });

  it("lists every additional salon, a temporary one with its end date, never the primary twice", () => {
    expect(additionalSalons(twoSalons("E2"))).toEqual(["Birch Hollow (temporary, until Dec 15, 2026)", "Cedar Point"]);
    expect(newHireNoticeText(twoSalons("E2")).body).toBe(
      "New employee Robin Quillfeather, robin.quillfeather@example.com in Woven, has been hired as Assistant Salon Director at Maple Grove on Nov 24, 2026. Additional salons: Birch Hollow (temporary, until Dec 15, 2026), Cedar Point.",
    );
  });

  it("says plainly what Woven does not have", () => {
    expect(newHireNoticeText(hire("E3", { emailAddress: "  ", positionName: null, primaryLocationId: null, primaryLocationName: null, locations: [] })).body).toBe(
      "New employee Robin Quillfeather (no email in Woven) has been hired as a position Woven does not name with no primary salon in Woven on Nov 24, 2026. No additional salons.",
    );
    expect(newHireNoticeText(hire("E4", { preferredFirstName: "Robbie" })).title).toBe("New hire: Robin Quillfeather (goes by Robbie) — Salon Director");
  });

  it("a termination: who, where, the dates Woven gives", () => {
    const gone = hire("T1", { employmentStatus: "terminated", terminationDate: "2026-11-20", terminationLastDayWorked: "2026-11-18" });
    expect(terminationNoticeText(gone)).toEqual({
      title: "Terminated: Robin Quillfeather — Salon Director",
      body: "Employee Robin Quillfeather, robin.quillfeather@example.com in Woven, Salon Director at Maple Grove, has been terminated in Woven. Termination date: Nov 20, 2026. Last day worked: Nov 18, 2026. No additional salons.",
    });
    expect(terminationNoticeText(hire("T2", { emailAddress: null })).body).toContain("Robin Quillfeather (no email in Woven), Salon Director at Maple Grove, has been terminated in Woven. Woven gives no termination date.");
  });

  it("a sign-in link sent: which app, to which address", () => {
    expect(inviteSentText(hire("E1"), "robin.quillfeather@example.com").body).toBe(
      "Robin Quillfeather was emailed their Ask Sunny sign-in link at robin.quillfeather@example.com (Salon Director at Maple Grove). No additional salons.",
    );
  });

  it("the webhook names the app and the event, for one n8n workflow serving both apps", () => {
    const payload = eventPayload("hired", twoSalons("E2"), newHireNoticeText(twoSalons("E2")));
    expect(payload).toMatchObject({
      app: "Ask Sunny",
      event: "hired",
      employee: { wovenEmployeeId: "E2", name: "Robin Quillfeather", email: "robin.quillfeather@example.com", location: "Maple Grove", additionalLocations: ["Birch Hollow (temporary, until Dec 15, 2026)", "Cedar Point"] },
    });
  });
});

describe("the window and the switches", () => {
  it("two weeks back by default, today included", () => {
    const since = windowStart("2026-11-28", readNewHireNoticeConfig(ON).backfillDays);
    expect(since).toBe("2026-11-14");
    expect(isRecentHire(hire("A", { hireDate: "2026-11-14" }), since, "2026-11-28")).toBe(true);
    expect(isRecentHire(hire("B", { hireDate: "2026-11-28" }), since, "2026-11-28")).toBe(true);
    expect(isRecentHire(hire("C", { hireDate: "2026-11-13" }), since, "2026-11-28")).toBe(false);
    expect(isRecentHire(hire("D", { hireDate: "2026-11-29" }), since, "2026-11-28")).toBe(false);
    expect(isRecentHire(hire("E", { hireDate: null }), since, "2026-11-28")).toBe(false);
    expect(isRecentHire(hire("F", { employmentStatus: "terminated" }), since, "2026-11-28")).toBe(false);
  });

  it("off by default; days 1–365 else 14; HR is a list; the webhook must be https", () => {
    expect(readNewHireNoticeConfig({})).toEqual({ enabled: false, backfillDays: 14, hrEmails: [], webhookUrl: null, webhookSecret: null });
    expect(readNewHireNoticeConfig({ ...ON, NEW_HIRE_NOTICE_BACKFILL_DAYS: "30" }).backfillDays).toBe(30);
    for (const bad of ["0", "366", "-3", "two weeks"]) expect(readNewHireNoticeConfig({ ...ON, NEW_HIRE_NOTICE_BACKFILL_DAYS: bad }).backfillDays).toBe(14);
    expect(readNewHireNoticeConfig({ WOVEN_HR_NOTIFY_EMAILS: " HR.Lead@example.com; other@example.com , not-an-email" }).hrEmails).toEqual(["hr.lead@example.com", "other@example.com"]);
    expect(readNewHireNoticeConfig({ WOVEN_EVENTS_WEBHOOK_URL: "http://n8n.example.com/x" }).webhookUrl).toBeNull();
    expect(readNewHireNoticeConfig({ WOVEN_EVENTS_WEBHOOK_URL: HOOK }).webhookUrl).toBe(HOOK);
  });

  it("recipients: each address once, admins keep their link, the new hire never hears about themselves", () => {
    const r = hireRecipients({ admins: ["Boss@example.com"], managers: ["boss@example.com", "robin.quillfeather@example.com", "sd@example.com"], hr: [HR], employeeEmail: "Robin.Quillfeather@example.com" });
    expect(r).toEqual([
      { email: "boss@example.com", admin: true },
      { email: "sd@example.com", admin: false },
      { email: HR, admin: false },
    ]);
  });
});

function fakeDeps(input: {
  hires?: HiredEmployee[];
  terminations?: { employee: HiredEmployee; eventDate: string }[];
  admins?: string[];
  managers?: { email: string; areas: string[] }[];
  webhookOk?: boolean;
}) {
  const ledger = new Map<string, { webhookSent: boolean }>();
  const rung: { recipientEmail: string; kind: string; body: string; href: string | null }[] = [];
  const posted: { url: string; secret: string | null; event: string; name: string }[] = [];
  const deps: NewHireNoticeDeps & { ledger: typeof ledger; rung: typeof rung; posted: typeof posted } = {
    ledger,
    rung,
    posted,
    recentHires: vi.fn(async () => input.hires ?? []),
    recentTerminations: vi.fn(async () => input.terminations ?? []),
    employee: vi.fn(async (id: string) => [...(input.hires ?? [])].find((h) => h.externalEmployeeId === id) ?? null),
    adminEmails: vi.fn(async () => input.admins ?? ["admin.one@example.com"]),
    salonManagers: vi.fn(async () => input.managers ?? []),
    claim: vi.fn(async (rows) => {
      const mine = new Set<string>();
      for (const r of rows) {
        const key = eventKey(r.event, r.externalEmployeeId, r.eventDate);
        if (ledger.has(key)) continue;
        ledger.set(key, { webhookSent: false });
        mine.add(key);
      }
      return mine;
    }),
    release: vi.fn(async (keys: readonly string[]) => keys.forEach((k) => ledger.delete(k))),
    unsentWebhooks: vi.fn(async (keys: readonly string[]) => new Set(keys.filter((k) => ledger.get(k)?.webhookSent === false))),
    markWebhookSent: vi.fn(async (keys: readonly string[]) => keys.forEach((k) => ledger.set(k, { webhookSent: true }))),
    ring: vi.fn(async (rows) => void rung.push(...rows)),
    postWebhook: vi.fn(async (url, secret, payload) => {
      posted.push({ url, secret, event: payload.event, name: payload.employee.name });
      return input.webhookOk ?? true;
    }),
  };
  return deps;
}

describe("announceNewHires — after a successful Woven sync", () => {
  it("off by default: reads nothing", async () => {
    const deps = fakeDeps({ hires: [hire("E1")] });
    expect(await announceNewHires({ env: {}, now: NOW }, deps)).toEqual({ status: "off" });
    expect(deps.recentHires).not.toHaveBeenCalled();
  });

  it("a hire reaches the admins, the managers of every salon the person is in, and HR — managers elsewhere do not", async () => {
    const deps = fakeDeps({
      hires: [twoSalons("E2")],
      admins: ["admin.one@example.com"],
      managers: [
        { email: "sd.maple@example.com", areas: ["loc-101"] },
        { email: "asd.cedar@example.com", areas: ["loc-200", "loc-103"] },
        { email: "sd.birch@example.com", areas: ["loc-102"] },
        { email: "sd.faraway@example.com", areas: ["loc-999"] },
      ],
    });
    expect(await announceNewHires({ env: ON, now: NOW }, deps)).toMatchObject({ status: "completed", hired: 1, bells: 5, since: "2026-11-14" });
    expect(new Set(deps.rung.map((r) => r.recipientEmail))).toEqual(new Set(["admin.one@example.com", "sd.maple@example.com", "asd.cedar@example.com", "sd.birch@example.com", HR]));
    // Only an admin's notice opens the admin-only Woven directory.
    expect(deps.rung.filter((r) => r.href === NEW_HIRE_NOTICE_HREF).map((r) => r.recipientEmail)).toEqual(["admin.one@example.com"]);
    expect(deps.rung.every((r) => r.kind === NEW_HIRE_NOTICE_KIND)).toBe(true);
  });

  it("a termination reaches HR only", async () => {
    const gone = hire("T1", { employmentStatus: "terminated", terminationDate: "2026-11-20" });
    const deps = fakeDeps({ terminations: [{ employee: gone, eventDate: "2026-11-21" }] });
    expect(await announceNewHires({ env: ON, now: NOW }, deps)).toMatchObject({ terminated: 1, bells: 1 });
    expect(deps.rung).toEqual([expect.objectContaining({ recipientEmail: HR, kind: TERMINATION_NOTICE_KIND, href: null })]);
  });

  it("backfills two weeks: the first run announces every hire in the window, oldest first", async () => {
    const deps = fakeDeps({ hires: [hire("E1"), hire("E2", { firstName: "Sage", lastName: "Morrowind", hireDate: "2026-11-16" })] });
    await announceNewHires({ env: ON, now: NOW }, deps);
    expect(deps.recentHires).toHaveBeenCalledWith("2026-11-14", "2026-11-28");
    expect(deps.rung[0].body).toContain("Sage Morrowind");
  });

  it("each event once, ever: the next sync announces only what is new", async () => {
    const deps = fakeDeps({ hires: [hire("E1")] });
    await announceNewHires({ env: ON, now: NOW }, deps);
    (deps.recentHires as ReturnType<typeof vi.fn>).mockResolvedValue([hire("E1"), hire("E9", { firstName: "Tamsin" })]);
    expect(await announceNewHires({ env: ON, now: NOW }, deps)).toMatchObject({ hired: 1 });
    expect(deps.rung.filter((r) => r.body.includes("Tamsin"))).toHaveLength(2);
    expect(deps.rung).toHaveLength(4);
  });

  it("emails Pau through the webhook for hires and terminations, with the secret; a failed one is retried next sync", async () => {
    const gone = hire("T1", { firstName: "Indigo", employmentStatus: "terminated" });
    const deps = fakeDeps({ hires: [hire("E1")], terminations: [{ employee: gone, eventDate: "2026-11-21" }], webhookOk: false });
    expect(await announceNewHires({ env: WITH_HOOK, now: NOW }, deps)).toMatchObject({ webhooks: 0, webhookFailed: 2 });
    (deps.postWebhook as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, secret: string | null, payload: { event: string; employee: { name: string } }) => {
      deps.posted.push({ url, secret, event: payload.event, name: payload.employee.name });
      return true;
    });
    expect(await announceNewHires({ env: WITH_HOOK, now: NOW }, deps)).toMatchObject({ hired: 0, terminated: 0, webhooks: 2, webhookFailed: 0 });
    // Bells were rung once; the email went on the retry.
    expect(deps.rung).toHaveLength(3);
    expect(deps.posted.slice(2)).toEqual([
      { url: HOOK, secret: "s3cret", event: "hired", name: "Robin Quillfeather" },
      { url: HOOK, secret: "s3cret", event: "terminated", name: "Indigo Quillfeather" },
    ]);
    expect(await announceNewHires({ env: WITH_HOOK, now: NOW }, deps)).toMatchObject({ webhooks: 0, webhookFailed: 0 });
  });

  it("no HR and no webhook: terminations are not read, so they are announced once someone is set", async () => {
    const deps = fakeDeps({ terminations: [{ employee: hire("T1"), eventDate: "2026-11-21" }] });
    await announceNewHires({ env: { NEW_HIRE_NOTICES_ENABLED: "true" }, now: NOW }, deps);
    expect(deps.recentTerminations).not.toHaveBeenCalled();
    expect(deps.ledger.size).toBe(0);
  });

  it("a failed bell write releases its claims, so the next run tries again; it never throws", async () => {
    const deps = fakeDeps({ hires: [hire("E1")] });
    (deps.ring as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("insert failed"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await announceNewHires({ env: ON, now: NOW }, deps)).toEqual({ status: "failed", code: "new_hire_notices_failed" });
    expect(deps.ledger.size).toBe(0);
    expect(await announceNewHires({ env: ON, now: NOW }, deps)).toMatchObject({ hired: 1 });
    errors.mockRestore();
  });

  it("someone outside the window or no longer active is never announced as a hire", async () => {
    const deps = fakeDeps({ hires: [hire("OLD", { hireDate: "2025-03-01" }), hire("GONE", { employmentStatus: "terminated" })] });
    expect(await announceNewHires({ env: ON, now: NOW }, deps)).toMatchObject({ hired: 0 });
    expect(deps.rung).toHaveLength(0);
  });
});

describe("announceInviteSent — the hourly run emailed the sign-in link", () => {
  it("tells the webhook once per person per day; off without the switch or a webhook", async () => {
    const deps = fakeDeps({ hires: [hire("E1")] });
    expect(await announceInviteSent({ externalEmployeeId: "E1", sentTo: "robin.quillfeather@example.com", env: ON, now: NOW }, deps)).toBe("off");
    expect(await announceInviteSent({ externalEmployeeId: "E1", sentTo: "robin.quillfeather@example.com", env: WITH_HOOK, now: NOW }, deps)).toBe("sent");
    expect(await announceInviteSent({ externalEmployeeId: "E1", sentTo: "robin.quillfeather@example.com", env: WITH_HOOK, now: NOW }, deps)).toBe("already_sent");
    expect(deps.posted).toEqual([{ url: HOOK, secret: "s3cret", event: "invite_sent", name: "Robin Quillfeather" }]);
    expect(deps.rung).toHaveLength(0);
  });
});
