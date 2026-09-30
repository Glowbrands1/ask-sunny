import { describe, expect, it } from "vitest";

import { audienceKey, decideAccess } from "../access";
import {
  WovenShapeError,
  unmatchedManagementEntries,
  audienceLabels,
  dateCell,
  parseHandbookManage,
  parseFileLibraryList,
  parseHandbookList,
  parseKnowledgeElementList,
  parsePolicyAttachments,
  parsePolicyList,
  policyAttachmentUrl,
  publicationOf,
  statusCell,
  toIsoDate,
} from "./adapters";
import { WovenTeamError } from "./http";
import { HtmlShapeError, parseHtmlDocument, readInlineVar } from "./html";
import { chooserAction, continueLoginSubmission, isAccountChooser, isCredentialForm, isProfilePhotoPrompt, profilePhotoSkip, readLoginForm } from "./session";
import { PASSWORD, USERNAME, accountChooserHtml, defaultState, loginPageHtml, profilePhotoHtml, uuid, verifiedChooserHtml } from "./test-support";

describe("dates, statuses and audiences", () => {
  it("normalises Woven's displayed and ISO dates", () => {
    expect(toIsoDate("5/1/2025")).toBe("2025-05-01");
    expect(toIsoDate("12/31/2026 3:00 PM")).toBe("2026-12-31");
    expect(toIsoDate("2026-05-13T14:02:11")).toBe("2026-05-13T14:02:11");
    expect(toIsoDate("Yesterday")).toBeNull();
    expect(dateCell('<span class="hidden">2025-10-09</span><span>10/9/2025</span>')).toBe("2025-10-09");
    expect(dateCell("<span>10/9/2025</span>")).toBe("2025-10-09");
  });

  it("an unrecognised status is 'unknown', never published", () => {
    expect(publicationOf("Published", ["published"], ["draft"])).toBe("published");
    expect(publicationOf(" DRAFT ", ["published"], ["draft"])).toBe("unpublished");
    expect(publicationOf("Pending Approval", ["published"], ["draft"])).toBe("unknown");
    expect(publicationOf(null, ["published"], ["draft"])).toBe("unknown");
  });

  it("audiences are keyed independent of order, case and spacing", () => {
    expect(audienceKey(["Managers", " All  Teams"])).toBe(audienceKey(["all teams", "managers"]));
    expect(audienceKey(null)).toBe("(none stated)");
    expect(audienceLabels("")).toBeNull();
    expect(audienceLabels("Managers, Directors")).toEqual(["Managers", "Directors"]);
  });

  it("only an all-Public audience is company-wide without a decision; a decision wins either way", () => {
    const none = new Map();
    expect(decideAccess(["Public"], ["Public"], none)).toEqual({ kind: "company_wide", basis: "public_audience" });
    expect(decideAccess(["Public", "Managers"], ["Public"], none)).toEqual({ kind: "review" });
    expect(decideAccess(null, ["Public"], none)).toEqual({ kind: "review" });
    const decided = new Map([["public", { source: "woven" as const, audienceKey: "public", decision: "excluded" as const, decidedBy: "a", decidedAt: "t" }]]);
    expect(decideAccess(["Public"], ["Public"], decided)).toEqual({ kind: "excluded", basis: "admin_decision" });
  });
});

describe("status cells with a DataTables sort key (live File Library and Handbook shape)", () => {
  /*
   * The Production scan of 29 September 2026 read the File Library status
   * column as "2 Published" (591) and "1 Unpublished" (56), and the one
   * handbook as "2 Published": a numeric sort key ahead of the label. Every
   * file and the published handbook were then excluded as not published.
   */
  it("reads the label, not the sort key, in every shape the key can take", () => {
    expect(statusCell('<span class="hidden">2</span>Published')).toBe("Published");
    expect(statusCell('<span class="hidden">1</span><span class="badge badge-secondary">Unpublished</span>')).toBe("Unpublished");
    expect(statusCell("2 Published")).toBe("Published");
    expect(statusCell("1 Unpublished")).toBe("Unpublished");
    expect(statusCell("Published")).toBe("Published");
    expect(statusCell("<span>Draft</span>")).toBe("Draft");
    expect(statusCell("")).toBeNull();
  });

  it("drops only a leading key: other text is not guessed at, and unknown stays unknown", () => {
    expect(statusCell("Version 2 Published")).toBe("Version 2 Published");
    expect(statusCell("2")).toBe("2");
    expect(publicationOf(statusCell("3 Pending Approval"), ["published"], ["unpublished"])).toBe("unknown");
  });

  it("File Library: the live rows are Published and Unpublished, not all unpublished", () => {
    const row = (n: number, status: string) => ({ EntityID: uuid(n), Column1: "PDF", Column2: `File ${n}`, Column3: status, Column4: "Public", Column5: "1 MB", Column6: "9/1/2026" });
    const { records } = parseFileLibraryList({
      list: [row(1, '<span class="hidden">2</span>Published'), row(2, "2 Published"), row(3, '<span class="hidden">1</span>Unpublished'), row(4, "1 Unpublished")],
    });
    expect(records.map((r) => [r.status, r.publication])).toEqual([
      ["Published", "published"],
      ["Published", "published"],
      ["Unpublished", "unpublished"],
      ["Unpublished", "unpublished"],
    ]);
  });

  it("Handbook: the live '2 Published' row is published", () => {
    const [row] = parseHandbookList({ list: [{ EntityID: uuid(1), Column1: "Team Member Handbook", Column2: "2 Published", Column3: "Public", Column4: "5/13/2026" }] });
    expect(row!.status).toBe("Published");
    expect(publicationOf(row!.status, ["published"], ["draft"])).toBe("published");
  });
});

describe("inline page variables", () => {
  const doc = (script: string) => parseHtmlDocument(`<html><body><script>${script}</script></body></html>`);

  it("reads strings, null and JSON arrays without evaluating anything", () => {
    expect(readInlineVar(doc(`var mA = 'x\\'y';`), "mA")).toBe("x'y");
    expect(readInlineVar(doc(`var mA = null;`), "mA")).toBeNull();
    expect(readInlineVar(doc(`var mA = [{"k":"a]b"}];`), "mA")).toEqual([{ k: "a]b" }]);
    expect(readInlineVar(doc(`if (mA == null) {}\nvar mA = "late";`), "mA")).toBe("late");
    expect(readInlineVar(doc(`var other = 1;`), "mA")).toBeUndefined();
  });

  it("a value that is not a plain literal is a shape error", () => {
    expect(() => readInlineVar(doc(`var mA = computeIt();`), "mA")).toThrow(HtmlShapeError);
    expect(() => readInlineVar(doc(`var mA = [{k: 1}];`), "mA")).toThrow(HtmlShapeError);
  });
});

describe("recognising the page after credentials", () => {
  it("the account chooser is recognised by its visible heading or its title", () => {
    const state = defaultState();
    expect(isAccountChooser(accountChooserHtml(state))).toBe(true);
    expect(isAccountChooser("<html><head><title>Select Company</title></head><body><table></table></body></html>")).toBe(true);
    expect(isAccountChooser("<html><body><p>Select account for login</p></body></html>")).toBe(true);
    expect(isAccountChooser(loginPageHtml("Invalid username or password."))).toBe(false);
  });

  it("the photo interstitial is recognised, and is not the credential form", () => {
    const state = defaultState();
    const html = profilePhotoHtml(state, uuid(9001));
    expect(isProfilePhotoPrompt(html)).toBe(true);
    expect(isCredentialForm(html)).toBe(false);
    expect(isAccountChooser(html)).toBe(false);
    expect(isProfilePhotoPrompt(loginPageHtml())).toBe(false);
    const skip = profilePhotoSkip(html, "/Login/Authenticate?ReturnUrl=%2F");
    expect(skip.path).toBe("/Login/Authenticate");
    expect(skip.fields.SkipAddEmployeeProfileImage).toBe("true");
    expect(skip.fields).not.toHaveProperty("ProfileImage");
  });

  it("only a page asking for a password is the credential form", () => {
    expect(isCredentialForm(loginPageHtml())).toBe(true);
    /* The chooser may post back to /Login/Authenticate; it asks for no password. */
    const state = defaultState();
    state.chooserMechanism = "form";
    expect(isCredentialForm(accountChooserHtml(state))).toBe(false);
  });

  it("reads the chooser entry for exactly the configured company, never a partial match", () => {
    const state = defaultState();
    state.chooserMechanism = "link";
    state.chooserAccounts = [
      { id: uuid(1), name: "JB & Associates West" },
      { id: uuid(2), name: "JB & Associates" },
    ];
    expect(chooserAction(accountChooserHtml(state), "JB & Associates")).toEqual({ kind: "link", href: `/Login/SelectAccount?pCompanyID=${uuid(2)}` });
  });

  it("the verified chooser: every rendered field kept as rendered; only CompanyID and CompanyName are set", () => {
    const state = defaultState();
    state.chooserCompanyName = "JB & Associates";
    const html = verifiedChooserHtml(state).replace(
      '<input type="hidden" name="ReturnUrl" value="/">',
      '<input type="hidden" name="ReturnUrl" value="/Home?tab=1"><input type="hidden" name="ExtraRendered" value="kept">',
    );
    const submission = continueLoginSubmission(html, "/Login/Authenticate?ReturnUrl=%2F", "JB & Associates");
    expect(submission.path).toBe("/Login/Authenticate");
    expect(submission.fields).toEqual({
      AuthenticationRequestUser: USERNAME,
      AuthenticationRequestPass: PASSWORD,
      ReturnUrl: "/Home?tab=1",
      ExtraRendered: "kept",
      CompanyID: uuid(9001),
      CompanyName: "JB & Associates",
      __RequestVerificationToken: "continue-token",
    });
  });

  it("the verified chooser refuses a form that is not a plain POST to /Login/Authenticate, or has no token", () => {
    const html = verifiedChooserHtml(defaultState());
    const refused = (h: string) => {
      try {
        continueLoginSubmission(h, "/Login/Authenticate", "JB & Associates");
        return null;
      } catch (e) {
        return e instanceof WovenTeamError ? e.code : "other";
      }
    };
    expect(refused(html.replace('method="post"', 'method="get"'))).toBe("account_chooser_changed");
    expect(refused(html.replace('action="/Login/Authenticate"', 'action="/Login/Elsewhere"'))).toBe("account_chooser_changed");
    expect(refused(html.replace('name="__RequestVerificationToken" value="continue-token"', 'name="__RequestVerificationToken" value=""'))).toBe("account_chooser_changed");
    expect(refused(html.replace(`data-company-id="${uuid(9001)}"`, 'data-company-id="not a uuid!"'))).toBe("account_chooser_changed");
    expect(refused(html)).toBeNull();
  });

  it("a login form that posts with ?ReturnUrl= is still the documented form, and is posted to as written", () => {
    const html = loginPageHtml().replace('action="/Login/Authenticate"', 'action="/Login/Authenticate?ReturnUrl=%2F"');
    expect(readLoginForm(html).action).toBe("/Login/Authenticate?ReturnUrl=%2F");
  });
});

describe("schema drift fails closed", () => {
  it("a login page without the documented form is login_page_changed", () => {
    expect(() => readLoginForm("<html><body><form action='/SignIn'></form></body></html>")).toThrow(/sign-in page/);
    expect(readLoginForm(loginPageHtml()).fields).toMatchObject({ __RequestVerificationToken: "login-token-123", IsLocationLogin: "False" });
  });

  it("rows that mostly lack an id refuse the listing", () => {
    const body = { list: [{ Column1: "Current" }, { Column1: "Draft" }, { EntityID: uuid(1), Column1: "Current" }] };
    expect(() => parseKnowledgeElementList(body)).toThrow(WovenShapeError);
  });

  it("a policy marked as having attachments that lists none is refused, not read as zero", () => {
    expect(() => parsePolicyAttachments("<html><body><p>no script</p></body></html>", true)).toThrow(WovenShapeError);
    expect(parsePolicyAttachments("<html><body></body></html>", false)).toEqual([]);
  });

  it("without an Audience header the audience is unknown, so the policy is held for review", () => {
    const html = `<table><thead><tr><th>Name</th></tr></thead><tbody><tr data-policy-id="${uuid(7)}" data-status="current"><td><a href="/Policy/Details/${uuid(7)}">P</a></td></tr></tbody></table>`;
    const listing = parsePolicyList(html);
    expect(listing.records[0]!.audience).toBeNull();
    expect(listing.diagnostics.audienceColumnFound).toBe(false);
  });

  it("a handbook page for a different handbook is refused", () => {
    const html = `<html><body><script>var mHandbookID = '${uuid(2)}';</script></body></html>`;
    expect(() => parseHandbookManage(html, uuid(1))).toThrow(WovenShapeError);
  });

  it("the signed URL is only ever read for the one document asked for", () => {
    const html = `<html><body><script>var mPolicyAttachments = [{"DocumentID":"${uuid(5)}","DocumentName":"a.pdf","AzureFileURL":"https://woven.blob.core.windows.net/policy/a.pdf?sig=x"}];</script></body></html>`;
    expect(policyAttachmentUrl(html, uuid(5))).toMatch(/^https:/);
    expect(policyAttachmentUrl(html, uuid(6))).toBeNull();
    expect(JSON.stringify(parsePolicyAttachments(html, true))).not.toContain("sig=");
  });
});

describe("procedure attachments: the management view never duplicates a downloadable one", () => {
  const located = (stepId: string, fileName: string) => ({ documentId: null, storedFileName: `${fileName}-stored`, stepId, fileName });
  const managed = (documentId: string, stepId: string, label: string) => ({ documentId, storedFileName: null, stepId, fileName: null, label });

  it("an entry whose text names a downloadable file is that file", () => {
    expect(unmatchedManagementEntries([located("s1", "05. EOM Core Process.pdf")], [managed("d1", "s1", "05. EOM Core Process.pdf (1.2 MB)")])).toEqual([]);
  });

  it("entries that name no file (live: all 22) are matched to their step's downloads by count", () => {
    expect(unmatchedManagementEntries([located("s1", "a.pdf"), located("s1", "b.pdf")], [managed("d1", "s1", "Attachment"), managed("d2", "s1", "Attachment")])).toEqual([]);
  });

  it("only a surplus — more entries than the page offers downloads for — is reported unlocated", () => {
    const out = unmatchedManagementEntries([located("s1", "a.pdf")], [managed("d1", "s1", "Attachment"), managed("d2", "s1", "Attachment"), managed("d3", "s2", "Attachment")]);
    expect(out.map((a) => a.documentId)).toEqual(["d2", "d3"]);
  });
});
