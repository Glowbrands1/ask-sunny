import { describe, expect, it } from "vitest";

import { classifyStatusError } from "./status";

/** "The migration is not applied" and "the database did not answer" are different facts. */

describe("classifyStatusError", () => {
  it("reads a missing relation as missing", () => {
    for (const code of ["42P01", "PGRST205", "PGRST200"]) {
      expect(classifyStatusError({ code }).reason).toBe("missing");
    }
  });

  it("reads everything else — timeouts, permissions, network — as unavailable, keeping the code", () => {
    for (const code of ["57014", "42501", "PGRST301", "08006"]) {
      const error = classifyStatusError({ code });
      expect(error.reason).toBe("unavailable");
      expect(error.code).toBe(code);
    }
    expect(classifyStatusError(null)).toMatchObject({ reason: "unavailable", code: null });
    expect(classifyStatusError({})).toMatchObject({ reason: "unavailable", code: null });
  });
});
