import { describe, expect, it } from "vitest";

import { oneDraftNotice } from "./one-draft-notice";

/* ONE_DRAFT_NOTICE_ENABLED (QA, 11 Nov 2026): one notice, the field not saved named, "what happened" asked once. */
describe("oneDraftNotice", () => {
  it("names the field not saved and asks once", () => {
    const notice = oneDraftNotice({ notSaved: ["Details of Coaching"] })!;
    expect(notice).toMatch(/^\*\*Details of Coaching\*\* wasn't saved;/);
    expect(notice).not.toMatch(/Nothing was saved/);
    expect(notice.match(/what happened/gi)).toHaveLength(1);
    expect(notice.match(/fill it in below/gi)).toHaveLength(1);
  });

  it("two fields, and a field named twice once", () => {
    expect(oneDraftNotice({ notSaved: ["Details of Coaching", "Other", "Other"] })).toMatch(/^\*\*Details of Coaching\*\* and \*\*Other\*\* weren't saved;/);
    expect(oneDraftNotice({ notSaved: ["Other", "Other"] })).toMatch(/^\*\*Other\*\* wasn't saved;/);
  });

  it("no field to name: none", () => {
    expect(oneDraftNotice({ notSaved: [] })).toBeNull();
  });
});
