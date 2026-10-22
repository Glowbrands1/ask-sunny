import { describe, expect, it } from "vitest";

import { escapeLike } from "./like";

describe("escapeLike", () => {
  it("escapes every ILIKE wildcard, so an address matches only itself", () => {
    expect(escapeLike("first_last@example.test")).toBe("first\\_last@example.test");
    expect(escapeLike("100%@example.test")).toBe("100\\%@example.test");
    expect(escapeLike("back\\slash@example.test")).toBe("back\\\\slash@example.test");
    expect(escapeLike("_%\\")).toBe("\\_\\%\\\\");
  });

  it("leaves an ordinary address untouched", () => {
    expect(escapeLike("manager@example.test")).toBe("manager@example.test");
    expect(escapeLike("")).toBe("");
  });
});
