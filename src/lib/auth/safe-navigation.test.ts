import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  SAFE_FALLBACK_PATH,
  safeInternalPath,
  safeInternalUrl,
} from "./safe-navigation";

/**
 * ============================================================================
 * ONE RULE FOR WHERE AN AUTH FLOW MAY SEND SOMEBODY.
 * ============================================================================
 *
 * Three copies of this check used to exist — the sign-in landing, the legacy
 * callback's `next`, and the activation landing — all testing the INPUT string
 * with `startsWith("/")` and `!startsWith("//")`.
 *
 * That accepts `/\evil.example`: one leading slash, and the second character is
 * a backslash rather than a slash. The WHATWG parser then treats backslashes as
 * slashes for special HTTP(S) schemes, so it resolves to
 * `https://evil.example/`. One of the three copies was fixed; the other two
 * were not, which is the whole argument for there being one.
 *
 * The tests below are organised around that: the ESCAPES list is the case
 * record, and the property sweep is the actual guarantee — it reads the origin
 * of the PARSED result, which is the only thing a browser cares about.
 */

const ORIGIN = "https://ask-sunny.preview.test";

/**
 * Every destination that must fail closed.
 *
 * The backslash forms are first because they are the ones a prefix test lets
 * through, and they are the reason this file exists.
 */
const ESCAPES: [string, string][] = [
  ["/\\evil.example", "a backslash host"],
  ["/\\\\evil.example", "a double backslash host"],
  ["/\\/evil.example", "a backslash then a slash"],
  ["/\\\\@evil.example", "a backslash host with userinfo"],
  ["/\\\\user:pass@evil.example", "a backslash host with credentials"],
  ["//evil.example", "a protocol-relative host"],
  ["//evil.example/steal", "a protocol-relative host with a path"],
  ["https://evil.example", "an absolute URL"],
  ["https://evil.example/x", "an absolute URL with a path"],
  ["javascript:alert(1)", "a script scheme"],
  ["data:text/html,x", "a data URL"],
  ["chat", "a bare relative path"],
  ["", "an empty string"],
];

/** Every destination that must be honoured, exactly as given. */
const ALLOWED: string[] = [
  "/",
  "/chat",
  "/chat?x=1",
  "/#section",
  "/forms/monitoring?view=all#top",
  "/reset-password",
];

describe("destinations that must fail closed", () => {
  it.each(ESCAPES)("refuses %s (%s)", (candidate) => {
    expect(safeInternalUrl(candidate, ORIGIN)).toBe(`${ORIGIN}/`);
  });

  it.each([null, undefined, 0, false, {}, [], NaN])(
    "refuses the non-string %s",
    (candidate) => {
      expect(safeInternalUrl(candidate, ORIGIN)).toBe(`${ORIGIN}/`);
    },
  );

  it("falls back to the app root, not to something clever", () => {
    // A fallback that guessed at "the last safe page" would be a second rule.
    expect(SAFE_FALLBACK_PATH).toBe("/");
    expect(safeInternalPath("/\\evil.example", ORIGIN)).toBe("/");
  });
});

describe("destinations that must be honoured", () => {
  it.each(ALLOWED)("accepts %s and resolves it against the trusted origin", (candidate) => {
    expect(safeInternalUrl(candidate, ORIGIN)).toBe(new URL(candidate, ORIGIN).toString());
  });

  it("preserves query and fragment untouched", () => {
    expect(safeInternalPath("/forms/monitoring?view=all&x=2#top", ORIGIN)).toBe(
      "/forms/monitoring?view=all&x=2#top",
    );
    expect(safeInternalPath("/chat?x=1", ORIGIN)).toBe("/chat?x=1");
    expect(safeInternalPath("/#section", ORIGIN)).toBe("/#section");
  });
});

describe("the guarantee, as a property rather than a list", () => {
  it("PARSES every result and finds the trusted origin", () => {
    /*
     * The load-bearing assertion. Both lists are swept together, so an input
     * that escapes fails whichever list somebody filed it under — which is
     * exactly the mistake that let the backslash through a test that was
     * checking the right thing about the wrong inputs.
     */
    for (const candidate of [...ESCAPES.map(([value]) => value), ...ALLOWED]) {
      const emitted = new URL(safeInternalUrl(candidate, ORIGIN));
      expect(emitted.origin, `${candidate} escaped to ${emitted.origin}`).toBe(ORIGIN);
      expect(emitted.username, candidate).toBe("");
      expect(emitted.password, candidate).toBe("");
      expect(["https:", "http:"], candidate).toContain(emitted.protocol);
    }
  });

  it("holds for a different trusted origin too", () => {
    // The origin is a parameter, so nothing is baked in to one deployment.
    for (const origin of ["https://other.test", "http://localhost:3000"]) {
      for (const candidate of ESCAPES.map(([value]) => value)) {
        expect(safeInternalUrl(candidate, origin)).toBe(`${origin}/`);
      }
      expect(safeInternalUrl("/chat", origin)).toBe(`${origin}/chat`);
    }
  });

  it("refuses everything when the trusted origin is itself opaque", () => {
    /*
     * If the page's own origin were opaque, `origin` is the string "null" and
     * would compare equal to another opaque origin — which is why the scheme
     * check exists. An unusable trusted origin makes the helper throw rather
     * than emit something; asserted so the behaviour is known rather than
     * discovered.
     */
    expect(() => safeInternalUrl("/chat", "null")).toThrow();
  });

  it("path and URL forms never disagree", () => {
    for (const candidate of [...ESCAPES.map(([value]) => value), ...ALLOWED]) {
      const asUrl = new URL(safeInternalUrl(candidate, ORIGIN));
      const asPath = safeInternalPath(candidate, ORIGIN);
      expect(asPath, candidate).toBe(`${asUrl.pathname}${asUrl.search}${asUrl.hash}`);
    }
  });
});

describe("there is only ONE copy of this rule", () => {
  /**
   * Every source file under the auth surfaces, so a fourth hand-rolled copy
   * fails here rather than being found in QA on whichever flow got it wrong.
   */
  function sources(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) found.push(...sources(path));
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        found.push(path);
      }
    }
    return found;
  }

  const FILES = [
    ...sources("src/features/auth"),
    ...sources("src/app/auth"),
    ...sources("src/lib/auth"),
  ].filter((path) => !path.endsWith("safe-navigation.ts"));

  it("finds the auth sources at all", () => {
    expect(FILES.length).toBeGreaterThan(5);
  });

  it.each(
    [
      ...sources("src/features/auth"),
      ...sources("src/app/auth"),
      ...sources("src/lib/auth"),
    ].filter((path) => !path.endsWith("safe-navigation.ts")),
  )("%s carries no redirect validation of its own", (file) => {
    const code = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    // The prefix test that let the backslash through, in any of its spellings.
    expect(code).not.toMatch(/startsWith\("\/\/"\)/);
    // And no re-implementation of the parsed checks.
    expect(code).not.toMatch(/\.origin !== |\.username !== |protocol !== "https:"/);
  });

  it("is the rule the three auth flows actually call", () => {
    const callers: [string, RegExp][] = [
      ["src/features/auth/sign-in-form.tsx", /safeInternalUrl\(/],
      ["src/app/auth/callback/route.ts", /safeInternalUrl\(/],
      ["src/features/auth/reset-password-form.tsx", /safeInternalPath\(/],
    ];
    for (const [file, pattern] of callers) {
      expect(readFileSync(file, "utf8"), file).toMatch(pattern);
    }
  });
});
