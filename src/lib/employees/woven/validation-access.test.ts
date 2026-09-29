import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { checkValidationAccessCode, validationAccessCodeConfigured, WOVEN_VALIDATION_ACCESS_CODE_ENV } from "./validation-access";

/** The demo-mode access code: compared server-side, never echoed, never weak. */

const CODE = "test-access-code-7f3a9c2e41b8";
const ENV = { WOVEN_VALIDATION_ACCESS_CODE: CODE };

describe("checkValidationAccessCode", () => {
  it("accepts exactly the configured code (surrounding whitespace ignored)", () => {
    expect(checkValidationAccessCode(CODE, ENV)).toBe("ok");
    expect(checkValidationAccessCode(` ${CODE}\n`, ENV)).toBe("ok");
  });

  it("refuses a missing or non-string code", () => {
    for (const presented of [undefined, null, "", "   ", 42, { code: CODE }]) {
      expect(checkValidationAccessCode(presented, ENV)).toBe("missing");
    }
  });

  it("refuses a wrong code, including near misses and different lengths", () => {
    for (const presented of ["nope", CODE.slice(0, -1), `${CODE}0`, CODE.toUpperCase(), "x".repeat(1000)]) {
      expect(checkValidationAccessCode(presented, ENV)).toBe("wrong");
    }
  });

  it("is not configured when unset or shorter than 16 characters — and then nothing is accepted", () => {
    for (const env of [{}, { WOVEN_VALIDATION_ACCESS_CODE: "" }, { WOVEN_VALIDATION_ACCESS_CODE: "short-code-15ch" }]) {
      expect(validationAccessCodeConfigured(env)).toBe(false);
      expect(checkValidationAccessCode(env.WOVEN_VALIDATION_ACCESS_CODE ?? "", env)).toBe("not_configured");
    }
    expect(validationAccessCodeConfigured(ENV)).toBe(true);
  });

  it("is a server-side variable: never NEXT_PUBLIC_, so never inlined into a client bundle", () => {
    expect(WOVEN_VALIDATION_ACCESS_CODE_ENV).toBe("WOVEN_VALIDATION_ACCESS_CODE");
    expect(WOVEN_VALIDATION_ACCESS_CODE_ENV.startsWith("NEXT_PUBLIC_")).toBe(false);
  });

  it("compares in constant time over digests, and is server-only", () => {
    const source = readFileSync(join(__dirname, "validation-access.ts"), "utf8");
    expect(source).toContain('import "server-only";');
    expect(source).toContain("timingSafeEqual(digest(");
    /* Never a direct string comparison of the code itself. */
    expect(source).not.toMatch(/(presented|expected)(\.trim\(\))?\s*[!=]==\s*(presented|expected)/);
    expect(source).not.toMatch(/console\./);
  });
});
