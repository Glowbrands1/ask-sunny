import { afterEach, describe, expect, it } from "vitest";

import { readEmployeeMentions } from "./proposal";

/* BC_NOT_A_NAME_ENABLED: conv_mvofjlco271mr0t's words, the person invented (as in the replay pack). */
const TURN = "crete a ca for orla penhallow bc she didnt do the deep clean i assignd by 9-15";
const FLAG = "BC_NOT_A_NAME_ENABLED";

afterEach(() => {
  delete process.env[FLAG];
});

describe("BC_NOT_A_NAME_ENABLED", () => {
  it("off: as before, \"bc\" is read into the name", () => {
    process.env[FLAG] = "false";
    expect(readEmployeeMentions(TURN).names).toEqual(["orla penhallow bc"]);
  });

  it("on: the name ends before \"bc\", in every case", () => {
    process.env[FLAG] = "true";
    expect(readEmployeeMentions(TURN).names).toEqual(["orla penhallow"]);
    expect(readEmployeeMentions(TURN.replace("orla penhallow", "Orla Penhallow")).names).toEqual(["Orla Penhallow"]);
    expect(readEmployeeMentions(TURN.toUpperCase()).names).toEqual(["ORLA PENHALLOW"]);
    expect(readEmployeeMentions("make a coaching form for orla penhallow b/c she was late").names).toEqual(["orla penhallow"]);
  });
});
