import { describe, expect, it } from "vitest";

import { CONTENT_TYPES, PartFetchError, type ListingResult } from "../types";
import { WovenConnectorError, WovenKnowledgeConnector } from "./connector";
import { WovenTeamClient } from "./http";
import type { CompanySelector } from "./session";
import { COMPANY, FakeWoven, PASSWORD, USERNAME, defaultState, noSleep, uuid } from "./test-support";

function connectorFor(fake: FakeWoven, options: { password?: string; company?: string; selector?: CompanySelector; maxBytes?: number } = {}) {
  const client = new WovenTeamClient({ baseUrl: "https://app.woven.team", fetch: fake.fetch, sleep: noSleep, transport: { minIntervalMs: 0, baseBackoffMs: 0 } });
  return {
    client,
    connector: new WovenKnowledgeConnector({
      client,
      credentials: { username: USERNAME, password: options.password ?? PASSWORD },
      company: options.company ?? COMPANY,
      selector: options.selector,
      maxBytes: options.maxBytes,
    }),
  };
}

function ok(listing: ListingResult) {
  if (!listing.ok) throw new Error(`listing failed: ${listing.code} ${listing.message}`);
  return listing;
}

describe("Woven Team sign-in", () => {
  it("reads the anti-forgery token and hidden fields from /Login and posts the documented form", async () => {
    const fake = new FakeWoven();
    const { connector } = connectorFor(fake);
    const info = await connector.connect();

    expect(info).toEqual({ companyLabel: COMPANY, companyVerified: true });
    const post = fake.log.find((r) => r.path === "/Login/Authenticate")!;
    expect(post.method).toBe("POST");
    expect(post.contentType).toMatch(/application\/x-www-form-urlencoded/);
    const form = new URLSearchParams(post.body);
    expect(form.get("__RequestVerificationToken")).toBe("login-token-123");
    expect(form.get("IsLocationLogin")).toBe("False");
    expect(form.has("SetTermsSignedDate")).toBe(true);
    /* The login page's anti-forgery cookie is sent back with the POST. */
    expect(post.cookie).toContain("__RequestVerificationToken_Cookie=af1");
  });

  it("reports a refused sign-in as login_failed, never as an empty library", async () => {
    const { connector } = connectorFor(new FakeWoven(), { password: "wrong" });
    await expect(connector.connect()).rejects.toMatchObject({ code: "woven_login_failed" });
  });

  it("stops precisely at the unverified company-selection step", async () => {
    const state = defaultState();
    state.requireCompanySelection = true;
    const fake = new FakeWoven(state);
    const { connector } = connectorFor(fake);
    await expect(connector.connect()).rejects.toMatchObject({ code: "woven_company_selection_unverified" });
    /* Nothing was read. */
    expect(fake.log.some((r) => r.path === "/Policy")).toBe(false);
  });

  it("uses a replacement CompanySelector once the step is known", async () => {
    const state = defaultState();
    state.requireCompanySelection = true;
    const fake = new FakeWoven(state);
    const selector: CompanySelector = { select: (_page, _company, client) => client.request("GET", "/Dashboard", null) };
    const { connector } = connectorFor(fake, { selector });
    await expect(connector.connect()).resolves.toMatchObject({ companyVerified: true });
  });

  it("refuses to read anything when the landing page is not JB & Associates", async () => {
    const state = defaultState();
    state.otherCompany = "Some Other Salon Group";
    const fake = new FakeWoven(state);
    const { connector } = connectorFor(fake);
    await expect(connector.connect()).rejects.toMatchObject({ code: "woven_company_not_verified" });
  });

  it("will not list before connecting", async () => {
    const { connector } = connectorFor(new FakeWoven());
    expect(await connector.list("policy")).toMatchObject({ ok: false, code: "woven_not_connected" });
  });
});

describe("the six adapters, against the handoff's shapes", () => {
  it("Policies: table rows, header-mapped audience and date, attachments from the detail page, no signed URL kept", async () => {
    const fake = new FakeWoven();
    const { connector } = connectorFor(fake);
    await connector.connect();
    const listing = ok(await connector.list("policy"));

    expect(listing.records.map((r) => r.title)).toEqual(["Attendance Policy", "Dress Code", "Manager Bonus Policy"]);
    const attendance = listing.records[0]!;
    expect(attendance).toMatchObject({ entityId: uuid(101), status: "current", publication: "published", audience: ["Public"], updatedAt: "2025-05-01", attachmentIds: [uuid(1101)] });
    expect(attendance.parts.map((p) => p.partKey)).toEqual(["content", `attachment:${uuid(1101)}`]);
    expect(attendance.parts[0]!.retrieval).toEqual({ kind: "blocked", capability: "policy_body" });
    expect(attendance.parts[1]!.retrieval).toEqual({ kind: "available", locator: { policyId: uuid(101), documentId: uuid(1101) } });
    expect(listing.diagnostics).toMatchObject({ audienceColumnFound: true, updatedColumnFound: true });
    expect(JSON.stringify(listing)).not.toMatch(/sig=|blob\.core|SECRET/);
  });

  it("Handbooks: DataTables rows plus the manage page's version ids; no current version means nothing published", async () => {
    const { connector } = connectorFor(new FakeWoven());
    await connector.connect();
    const listing = ok(await connector.list("handbook"));
    const [published, draft] = listing.records;
    expect(published).toMatchObject({ title: "Team Member Handbook", publication: "published", versionId: uuid(2101), updatedAt: "2026-05-13T14:02:11", audience: ["Public"] });
    expect(published!.parts[0]!.retrieval).toEqual({ kind: "available", locator: { handbookId: uuid(201), versionId: uuid(2101) } });
    expect(draft!.publication).toBe("unpublished");
  });

  it("Procedures: ids from cards, a deterministic detail fingerprint, content blocked", async () => {
    const fake = new FakeWoven();
    const { connector } = connectorFor(fake);
    await connector.connect();
    const first = ok(await connector.list("procedure"));
    const again = ok(await connector.list("procedure"));
    expect(first.records.map((r) => r.title)).toEqual(["Opening the Salon", "Bed Cleaning"]);
    /* The pages carry a rotating token and a random script value; neither is a change. */
    expect(again.records.map((r) => r.contentFingerprint)).toEqual(first.records.map((r) => r.contentFingerprint));
    expect(first.records[0]!.parts[0]!.retrieval).toEqual({ kind: "blocked", capability: "procedure_content" });

    fake.state.procedures[0]!.body = "Step 1. Unlock. Step 2. Lights. Step 3. Music.";
    const changed = ok(await connector.list("procedure"));
    expect(changed.records[0]!.contentFingerprint).not.toBe(first.records[0]!.contentFingerprint);
    expect(changed.records[1]!.contentFingerprint).toBe(first.records[1]!.contentFingerprint);
  });

  it("File Library: every row tracked; PDFs blocked on the unverified download, video unsupported, unpublished excluded", async () => {
    const { connector } = connectorFor(new FakeWoven());
    await connector.connect();
    const listing = ok(await connector.list("file_library"));
    const [pdf, video, old] = listing.records;
    expect(pdf).toMatchObject({ title: "Lotion Guide", publication: "published", audience: ["Public"], updatedAt: "2026-09-01" });
    expect(pdf!.parts[0]!.retrieval).toEqual({ kind: "blocked", capability: "file_library_download" });
    expect(video!.parts[0]!.retrieval.kind).toBe("unsupported_format");
    expect(old!.publication).toBe("unpublished");
    expect(listing.diagnostics).toMatchObject({ typeLabels: { PDF: 2, Video: 1 } });
  });

  it("Knowledge Elements and Courses: status, version and the hidden ISO date; content blocked", async () => {
    const { connector } = connectorFor(new FakeWoven());
    await connector.connect();
    const ke = ok(await connector.list("knowledge_element"));
    expect(ke.records[0]).toMatchObject({ title: "Spray Tan Basics", status: "Current", publication: "published", version: "v2", updatedAt: "2025-10-09" });
    expect(ke.records[1]).toMatchObject({ status: "Draft", publication: "unpublished" });
    const courses = ok(await connector.list("course"));
    expect(courses.records[0]).toMatchObject({ title: "Onboarding", version: "v3", updatedAt: "2025-10-13" });
    expect(courses.records[0]!.parts[0]!.retrieval).toEqual({ kind: "blocked", capability: "course_content" });
  });

  it("sends the list bodies the handoff documents", async () => {
    const fake = new FakeWoven();
    const { connector } = connectorFor(fake);
    await connector.connect();
    for (const type of CONTENT_TYPES) ok(await connector.list(type));
    const body = (path: string) => fake.log.find((r) => r.path === path)?.body;
    expect(JSON.parse(body("/KnowledgeCenter/_Search_Procedures")!)).toEqual({ pModel: { FilterText: "", Categories: [], Frequencies: [], Positions: [], Tags: [] } });
    expect(JSON.parse(body("/KnowledgeElement/_KnowledgeElement_List_ForDataTable")!)).toEqual({ pModel: { LearningElementStatus: "null", Tags: [] } });
    expect(JSON.parse(body("/Course/_Course_List_ForDataTable")!)).toEqual({ pModel: { LearningElementStatus: "null", Tags: [], IsArchived: false } });
    expect(body("/KnowledgeCenter/_Handbooks_List_ForDataTable")).toBe("");
    expect(fake.log.find((r) => r.path === "/FileLibrary/_FileLibrary_Management_List_ForDataTable")!.contentType).toBe("application/json; charset=utf-8");
  });
});

describe("failing closed", () => {
  it("re-authenticates once when the session expires mid-listing, and carries on", async () => {
    const fake = new FakeWoven();
    const { connector } = connectorFor(fake);
    await connector.connect();
    fake.expireSessionAfter = 2;
    const listing = ok(await connector.list("policy"));
    expect(listing.records).toHaveLength(3);
    expect(fake.logins).toBe(2);
  });

  it("a login page where data was expected is a failed listing, not an empty one", async () => {
    const fake = new FakeWoven();
    const { connector } = connectorFor(fake);
    await connector.connect();
    fake.loginInstead.add("/FileLibrary/_FileLibrary_Management_List_ForDataTable");
    const listing = await connector.list("file_library");
    expect(listing.ok).toBe(false);
  });

  it("a changed response shape (no `list`) is a failed listing", async () => {
    const fake = new FakeWoven();
    const { connector } = connectorFor(fake);
    await connector.connect();
    fake.malformed.add("/Course/_Course_List_ForDataTable");
    expect(await connector.list("course")).toMatchObject({ ok: false, code: "woven_unexpected_shape" });
  });

  it("a server error on one adapter leaves the others working", async () => {
    const fake = new FakeWoven();
    const { connector } = connectorFor(fake);
    await connector.connect();
    fake.failures.set("/KnowledgeCenter/_Search_Procedures", 500);
    expect((await connector.list("procedure")).ok).toBe(false);
    expect((await connector.list("handbook")).ok).toBe(true);
  });

  it("a policy page that drops its table is a failed listing", async () => {
    const fake = new FakeWoven();
    const { connector } = connectorFor(fake);
    await connector.connect();
    fake.state.policies = [];
    /* An empty table is still a table: that is a legitimate (if suspicious) answer the engine judges. */
    expect((await connector.list("policy")).ok).toBe(true);
    fake.failures.set("/Policy", 200);
    expect(await connector.list("policy")).toMatchObject({ ok: false, code: "woven_unexpected_shape" });
  });
});

describe("downloads", () => {
  it("handbook: asks for a fresh link, downloads it WITHOUT the Woven cookie, and never keeps the URL", async () => {
    const fake = new FakeWoven();
    const { connector } = connectorFor(fake);
    await connector.connect();
    const file = await connector.fetchPart({ contentType: "handbook", entityId: uuid(201), partKey: "current-version", locator: { handbookId: uuid(201), versionId: uuid(2101) }, fileName: null, mimeType: null });
    expect(new TextDecoder().decode(file.bytes)).toBe("%PDF handbook v1");
    expect(file).toMatchObject({ fileName: "Team Member Handbook.pdf", mimeType: "application/pdf" });
    const form = new URLSearchParams(fake.log.find((r) => r.path === "/KnowledgeCenter/_Handbook_DownloadVersion")!.body);
    expect(Object.fromEntries(form)).toEqual({ pHandbookID: uuid(201), pHandbookVersionID: uuid(2101) });
    expect(fake.blobRequests).toHaveLength(1);
    expect(fake.blobRequests[0]!.cookie).toBeNull();
  });

  it("policy attachment: re-reads the detail page for a fresh link; an expired link is replaced once", async () => {
    const fake = new FakeWoven();
    const { connector } = connectorFor(fake);
    await connector.connect();
    fake.expireNextLinks = 1;
    const file = await connector.fetchPart({ contentType: "policy", entityId: uuid(101), partKey: `attachment:${uuid(1101)}`, locator: { policyId: uuid(101), documentId: uuid(1101) }, fileName: "Attendance Policy.pdf", mimeType: "application/pdf" });
    expect(new TextDecoder().decode(file.bytes)).toBe("%PDF attendance v1");
    expect(fake.log.filter((r) => r.path === `/Policy/Details/${uuid(101)}`)).toHaveLength(2);
    expect(fake.blobRequests.every((r) => r.cookie === null)).toBe(true);
  });

  it("two expired links in a row are a retryable per-item failure whose message carries no URL", async () => {
    const fake = new FakeWoven();
    const { connector } = connectorFor(fake);
    await connector.connect();
    fake.expireNextLinks = 2;
    const error = await connector
      .fetchPart({ contentType: "policy", entityId: uuid(101), partKey: `attachment:${uuid(1101)}`, locator: { policyId: uuid(101), documentId: uuid(1101) }, fileName: "a.pdf", mimeType: "application/pdf" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PartFetchError);
    expect(error).toMatchObject({ category: "woven_download_link_expired", retryable: true });
    expect((error as Error).message).not.toMatch(/https?:|sig=|blob/);
  });

  it("a file over the size limit is refused and not retried", async () => {
    const fake = new FakeWoven();
    const { connector } = connectorFor(fake, { maxBytes: 4 });
    await connector.connect();
    const error = await connector
      .fetchPart({ contentType: "handbook", entityId: uuid(201), partKey: "current-version", locator: { handbookId: uuid(201), versionId: uuid(2101) }, fileName: null, mimeType: null })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ category: "woven_too_large", retryable: false });
  });

  it("an expired session during a download signs in again", async () => {
    const fake = new FakeWoven();
    const { connector } = connectorFor(fake);
    await connector.connect();
    fake.expireSession();
    const file = await connector.fetchPart({ contentType: "handbook", entityId: uuid(201), partKey: "current-version", locator: { handbookId: uuid(201), versionId: uuid(2101) }, fileName: null, mimeType: null });
    expect(file.bytes.byteLength).toBeGreaterThan(0);
    expect(fake.logins).toBe(2);
  });

  it("a signed-in session that cannot be re-established is reported as session lost", async () => {
    const fake = new FakeWoven();
    const { connector } = connectorFor(fake);
    await connector.connect();
    fake.expireSession();
    fake.state.otherCompany = "Elsewhere Inc";
    const error = await connector
      .fetchPart({ contentType: "handbook", entityId: uuid(201), partKey: "current-version", locator: { handbookId: uuid(201), versionId: uuid(2101) }, fileName: null, mimeType: null })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ sessionLost: true });
  });

  it("refuses parts whose download is not established", async () => {
    const { connector } = connectorFor(new FakeWoven());
    await connector.connect();
    await expect(
      connector.fetchPart({ contentType: "file_library", entityId: uuid(401), partKey: "file", locator: {}, fileName: null, mimeType: null }),
    ).rejects.toMatchObject({ category: "capability_unavailable", retryable: false });
  });

  it("connector errors carry woven_ codes", () => {
    expect(new WovenConnectorError("woven_login_failed", "x").code).toBe("woven_login_failed");
  });
});
