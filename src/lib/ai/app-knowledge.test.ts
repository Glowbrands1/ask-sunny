import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { resolvePolicyManual, type ManualChunk } from "@/lib/forms/official-policy-manual";
import { KNOWLEDGE_CATEGORIES } from "@/data/knowledge-taxonomy";
import { inlineDraftTemplateKeys } from "@/lib/forms/inline-draft";
import { TEMPLATE_SEEDS } from "@/lib/forms/library";
import { DEFAULT_PERMISSION_MATRIX, hasPermission } from "@/lib/permissions";
import { ALLOWED_VIDEO_MIME_TYPES, VIDEO_LIMITS } from "@/lib/videos/policy";
import { APP_GUIDE, appGuideChunks } from "@/test/app-guide-chunks";

import { ASK_SUNNY_APP_KNOWLEDGE, asksAboutTheApp, selectAppKnowledgeRows } from "./app-knowledge";

describe("asksAboutTheApp", () => {
  it.each([
    "How can I change the password on this platform",
    "how do I log in to Ask Sunny?",
    "can I upload a video on here?",
    "what can this app do?",
    "is my chat on this platform private?",
  ])("reads %j as a question about Ask Sunny", (question) => {
    expect(asksAboutTheApp(question)).toBe(true);
  });

  it.each([
    // Code review, 8 October: each of these pinned the app guide.
    "What are the assistant salon director's duties?",
    "How do I process the application for a new hire?",
    "how do I clean the tool for spray tan",
    "How do I reset my email password?",
    "How do I reset my Power BI password",
    "What is the alarm password",
    "How can I change my password",
    "How do I reset my SunLync password?",
    "What is the Woven login process for new hires?",
    "How do I change the salon email password?",
    "What does the dress code say about shoes?",
    "the thermostat is asking for a password",
  ])("leaves %j to ordinary retrieval", (question) => {
    expect(asksAboutTheApp(question)).toBe(false);
  });
});

describe("the app knowledge document's identity", () => {
  const candidate = (overrides: Record<string, unknown>) => ({
    id: "doc",
    title: "something else",
    category: "other",
    original_filename: "something.txt",
    tags: [],
    version: 1,
    source: "upload",
    ...overrides,
  });

  it("is found by the file name it was uploaded under", () => {
    const resolved = resolvePolicyManual(
      [candidate({ id: "app", title: "ask sunny app knowledge", original_filename: "ask-sunny-app-knowledge.txt" }), candidate({ id: "jba", title: "JBA Policy Manual", original_filename: "JBA-Policy-Manual.pdf" })],
      ASK_SUNNY_APP_KNOWLEDGE,
    );
    expect(resolved).toMatchObject({ ok: true, document: { id: "app" } });
  });

  it("prefers a tagged copy", () => {
    const resolved = resolvePolicyManual(
      [candidate({ id: "old", original_filename: "ask-sunny-app-knowledge.txt" }), candidate({ id: "tagged", tags: ["ask-sunny-app-knowledge"] })],
      ASK_SUNNY_APP_KNOWLEDGE,
    );
    expect(resolved).toMatchObject({ ok: true, document: { id: "tagged" } });
  });

  it("finds nothing in a corpus without one", () => {
    expect(resolvePolicyManual([candidate({})], ASK_SUNNY_APP_KNOWLEDGE)).toEqual({ ok: false, problem: "not_found" });
  });
});

describe("selectAppKnowledgeRows for the 1★ password question", () => {
  const rows = selectAppKnowledgeRows({
    question: "How can I change the password on this platform",
    documentId: "app-doc",
    documentTitle: "ask sunny app knowledge",
    chunks: appGuideChunks(),
  });

  it("pins the signing-in section and the document's answering rules", () => {
    const locators = rows.map((row) => row.locator);
    expect(locators).toContain("SIGNING IN AND ACCOUNTS");
    expect(locators).toContain("ANSWERING RULES AND RESTRICTIONS (ALWAYS FOLLOW THESE)");
    // At most three matched sections, plus the rules — two chunks once ingested.
    const rules = rows.filter((row) => /ANSWERING RULES/.test(row.locator));
    expect(rows.length - rules.length).toBeLessThanOrEqual(3);
  });

  it("cites the real document, never measured", () => {
    for (const row of rows) {
      expect(row.document_id).toBe("app-doc");
      expect(row.similarity).toBe(0);
    }
  });

  it("matches whole words, not letters inside them", () => {
    const rows = selectAppKnowledgeRows({
      question: "Ask Sunny tan app",
      documentId: "d",
      documentTitle: "t",
      chunks: [
        { chunkIndex: 0, chunkId: "a", locator: "A", page: null, section: null, content: "important approve constant happen" } as ManualChunk,
        { chunkIndex: 1, chunkId: "b", locator: "B", page: null, section: null, content: "Use the app to book a tan." } as ManualChunk,
      ],
    });
    expect(rows.map((row) => row.chunk_id)).toEqual(["b"]);
  });

  it("pins nothing when the question shares no words with the document", () => {
    expect(
      selectAppKnowledgeRows({ question: "zzz qqq", documentId: "d", documentTitle: "t", chunks: appGuideChunks() }),
    ).toEqual([]);
  });
});

describe("the corrected app knowledge document", () => {
  it("no longer sends anyone to a password option that does not exist", () => {
    expect(APP_GUIDE).not.toMatch(/account menu \(the user's avatar\)/i);
    expect(APP_GUIDE).not.toMatch(/passwords can be changed anytime/i);
    expect(APP_GUIDE).not.toMatch(/My Team page/);
  });

  it("describes the reset flow the app actually has", () => {
    const signIn = readFileSync("src/features/auth/sign-in-form.tsx", "utf8");
    const forgot = readFileSync("src/features/auth/forgot-password-form.tsx", "utf8");
    // The link text on the sign-in page, and the page it opens.
    expect(signIn).toContain("Forgot your password?");
    expect(signIn).toContain('href="/forgot-password"');
    expect(APP_GUIDE).toContain('"Forgot your password?"');
    // What the forgot-password page promises: single use, short-lived, spam, then an administrator.
    expect(forgot).toMatch(/can be used once and\s+expires shortly/);
    expect(APP_GUIDE).toMatch(/can be used once and expires shortly/);
    expect(forgot).toMatch(/Check the spam folder, then ask an administrator/);
    expect(APP_GUIDE).toMatch(/check the spam folder, then ask an administrator/i);
    expect(APP_GUIDE).toMatch(/no "change password" option inside Ask Sunny/);
  });

  it("names account management as an administrator's job, as the permissions do", () => {
    const permissions = readFileSync("src/lib/permissions/index.ts", "utf8");
    expect(permissions).toMatch(/permission === "manage_users"/);
    expect(APP_GUIDE).toMatch(/Accounts are created by an administrator/);
  });

  it("carries no default password", () => {
    // No sentence that states a password; the patterns here name no real one.
    expect(APP_GUIDE).not.toMatch(/\b(?:default|temporary|initial)\s+password\s+(?:for\s+\S+\s+)?(?:is|=|:)/i);
  });
});

/*
 * ============================================================================
 * THE GUIDE AGAINST THE CODE
 * ============================================================================
 *
 * Final review, 8 October: the indexed guide described chat uploads, voice
 * dictation, image generation, What's New and a Best Practices page that do
 * not exist, gave EPPs and video uploads to the wrong roles and put the video
 * limit at 500 MB. Sunny answers app questions from this document, so what it
 * says about access and limits is checked against the code that enforces them.
 */
describe("the app guide says what the code enforces", () => {
  const can = (role: string, permission: string) =>
    hasPermission(DEFAULT_PERMISSION_MATRIX, role as never, permission as never);

  /*
   * WHICH FORMS CHAT CAN DRAFT is the inline-draft list, and the guide names
   * every one of them and every other published template — by name, under the
   * role the template's own permission allows.
   */
  it("lists exactly the forms chat can draft, and says the rest cannot be drafted yet", () => {
    const inline = new Set(inlineDraftTemplateKeys());
    const drafted = APP_GUIDE.slice(APP_GUIDE.indexOf("Which forms can be drafted in chat"), APP_GUIDE.indexOf("Ask Sunny recognises some other"));
    const notYet = APP_GUIDE.slice(APP_GUIDE.indexOf("Ask Sunny recognises some other"), APP_GUIDE.indexOf("These permissions are fixed"));
    const shortName = (name: string) => name.replace(/ — .*$/, "").replace(/ Form$/, "");
    for (const seed of TEMPLATE_SEEDS) {
      const named = shortName(seed.name);
      if (inline.has(seed.key)) {
        expect(drafted, seed.key).toContain(named);
        const line = drafted.split("\n").find((text) => text.includes(named)) ?? "";
        const firstRole = can("salon_director", seed.requiredPermission) ? "Salon Director and above" : "District Manager and above";
        expect(line, seed.key).toContain(firstRole);
      } else {
        expect(notYet, seed.key).toContain(named.replace(" Interview", ""));
      }
    }
  });

  it("describes what an employee account can do", () => {
    expect([...DEFAULT_PERMISSION_MATRIX.employee].sort()).toEqual(["ask_questions", "view_knowledge", "view_videos"]);
    expect(APP_GUIDE).toMatch(/Employees with an account can also ask questions, open the documents an answer cites, and watch videos/);
  });

  it("gives form creation to Salon Directors and none to Assistant Salon Directors", () => {
    for (const permission of ["create_coaching_form", "create_corrective_action", "create_policy_review", "create_exit_form", "create_employment_change_form", "create_hiring_form"]) {
      expect(can("salon_director", permission), permission).toBe(true);
      expect(can("assistant_salon_director", permission), permission).toBe(false);
    }
    expect(APP_GUIDE).toMatch(/Assistant Salon Directors can get coaching guidance and view Form Monitoring, but do not create forms/);
  });

  it("gives the EPPs, templates and video uploads to District Managers", () => {
    for (const permission of ["create_epp", "manage_form_templates", "manage_videos"]) {
      expect(can("salon_director", permission), permission).toBe(false);
      expect(can("district_manager", permission), permission).toBe(true);
    }
    expect(APP_GUIDE).toMatch(/District Manager and above: also the SDIT EPP and the TSD EPP/);
    expect(APP_GUIDE).toMatch(/Form Templates \(District Manager and above\)/);
    expect(APP_GUIDE).toMatch(/District Managers and above can upload videos/);
  });

  it("states the video limit and formats the upload accepts", () => {
    expect(VIDEO_LIMITS.maxBytes).toBe(50 * 1024 * 1024);
    expect([...ALLOWED_VIDEO_MIME_TYPES].sort()).toEqual(["video/mp4", "video/quicktime", "video/webm"]);
    expect(APP_GUIDE).toMatch(/MP4, WebM or QuickTime \(\.mov\), up to 50 MB/);
  });

  it("counts the Knowledge Base categories", () => {
    expect(KNOWLEDGE_CATEGORIES).toHaveLength(10);
    expect(APP_GUIDE).toMatch(/in 10 categories/);
  });

  it("describes none of the features that do not exist", () => {
    for (const claim of [/paperclip/i, /voice dictation(?! or)/i, /generates images/i, /what's new/i, /best practices/i, /500 MB/, /11 categories/, /My Team/, /\bM4V\b/, /admins can adjust/i, /\[Employee\]/]) {
      expect(APP_GUIDE, String(claim)).not.toMatch(claim);
    }
  });

  it("gives every section its own heading once ingested", () => {
    const locators = new Set(appGuideChunks().map((chunk) => chunk.locator));
    for (const heading of ["SIGNING IN AND ACCOUNTS", "THE CHAT WORKSPACE", "REPORTS AND DAILY STATS", "CREATING FORMS", "TUTORIAL VIDEOS", "LEADERSHIP AND ADMIN FEATURES (ONLY DISCUSS WITH ROLES THAT HAVE THEM)", "COMMON QUESTIONS AND ANSWERS"]) {
      expect(locators, heading).toContain(heading);
    }
  });
});
