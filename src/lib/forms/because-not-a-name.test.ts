import { afterEach, describe, expect, it, vi } from "vitest";

import { extractEmployeeNames } from "./proposal";
import { canonicalShorthand } from "./template-intent";

/* October triage #15 (Sunny #250), the reporter's wording with an invented name. */
const TURN = "crete a ca for tamsin oakridge bc she didnt do the deep clean i assignd by 9-15";

describe("BECAUSE_NOT_A_NAME_ENABLED", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("off: the name runs over \"bc\", as before", () => {
    vi.stubEnv("BECAUSE_NOT_A_NAME_ENABLED", "false");
    expect(extractEmployeeNames(TURN)).toEqual(["tamsin oakridge bc"]);
  });

  it("on: the name stops at \"bc\"", () => {
    vi.stubEnv("BECAUSE_NOT_A_NAME_ENABLED", "true");
    expect(extractEmployeeNames(TURN)).toEqual(["tamsin oakridge"]);
    expect(extractEmployeeNames("write up for tamsin oakridge b/c she was late")).toEqual(["tamsin oakridge"]);
    expect(extractEmployeeNames("CA FOR TAMSIN OAKRIDGE BC SHE WAS LATE")).toEqual(["TAMSIN OAKRIDGE"]);
  });

  it("on: only the whole word is rewritten", () => {
    vi.stubEnv("BECAUSE_NOT_A_NAME_ENABLED", "true");
    expect(canonicalShorthand("abc bcc bc b/c bcuz")).toBe("abc bcc because because because");
  });
});
