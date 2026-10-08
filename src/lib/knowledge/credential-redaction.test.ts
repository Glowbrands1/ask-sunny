import { describe, expect, it } from "vitest";

import {
  asksForDefaultCredentials,
  redactDefaultPasswords,
  rowsForQuestion,
  WITHHELD_PASSWORD,
} from "./credential-redaction";
import type { MatchedChunkRow } from "./mappers";

/*
 * The shape of the live "New Hire Password Process" section, with stand-in
 * values: no real credential belongs in a test file.
 */
const NEW_HIRE_SECTION = [
  "New Hire Password Process",
  "1. SunLync: The new employee will need to immediately go to SunLync and create a password, the SunLync default password is *example1",
  "2. MyGlow: Then log in to MyGlow and set their password to the same password they set in SunLync, the MyGlow default password is Ex4mple! plus the last four numbers of the new hire's social security number.",
  "3. Woven: New Hire and Rehire employees will automatically receive an email.",
].join("\n");

const THERMOSTAT = 'Enter LOCK MENU. Enter Password "0000" on the number keypad. (Factory set password is "0000")';

function row(content: string): MatchedChunkRow {
  return {
    chunk_id: "c1",
    document_id: "d1",
    document_title: "Salon Director SD Manual 9.21.2026",
    category: "other",
    locator: "Page 40",
    page: null,
    section: null,
    content,
    similarity: 0.85,
  };
}

describe("redactDefaultPasswords", () => {
  const redacted = redactDefaultPasswords(NEW_HIRE_SECTION);

  it("withholds both default passwords and the SSN rule that completes one", () => {
    expect(redacted).not.toContain("*example1");
    expect(redacted).not.toContain("Ex4mple!");
    expect(redacted).not.toMatch(/social security/i);
    expect(redacted.match(new RegExp(WITHHELD_PASSWORD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(2);
  });

  it("keeps the rest of the section, so the answer can still point at it", () => {
    expect(redacted).toContain("New Hire Password Process");
    expect(redacted).toContain("immediately go to SunLync and create a password");
    expect(redacted).toContain("Woven: New Hire and Rehire employees");
  });

  /*
   * CODE REVIEW, 8 OCTOBER. Each of these leaked the value: a colon after
   * "is", the system named between the words, a plural, a value with spaces,
   * a value that wraps onto the next line as it does in the live manuals.
   */
  it.each([
    ["the SunLync default password is: Secret123", "Secret123"],
    ["the default password for MyGlow is Secret123. Change it today.", "Secret123"],
    ["Default passwords are Sun Tan1 and Glow2", "Tan1"],
    ["the temporary password will be the employee's last name + 1234", "1234"],
    ["Default PIN: 4321", "4321"],
    ["the MyGlow default password is Ex4mple! plus the\nlast four numbers of the new hire's social security number.", "social security"],
    ["• MyGlow: the MyGlow default password is Ex4mple! plus the last four numbers of the new\nhires social security number.\n• Woven: email.", "social security"],
  ])("withholds %j", (text, secret) => {
    const redacted = redactDefaultPasswords(text);
    expect(redacted).not.toContain(secret);
    expect(redacted).toContain(WITHHELD_PASSWORD);
  });

  it("stops at the end of the sentence, the list item or the paragraph", () => {
    expect(redactDefaultPasswords("the default password for MyGlow is Secret123. Change it today.")).toMatch(/\. Change it today\.$/);
    expect(redactDefaultPasswords("1. the SunLync default password is X1\n2. MyGlow: log in.")).toContain("2. MyGlow: log in.");
    expect(redactDefaultPasswords("• the default password is X1\n• Woven: email.")).toContain("• Woven: email.");
  });

  it("leaves policy text about passwords alone", () => {
    const policy = "Do not use default passwords, i.e., password123. The password should be 8-10 characters long.";
    expect(redactDefaultPasswords(policy)).toBe(policy);
  });

  it("leaves an equipment factory code alone", () => {
    expect(redactDefaultPasswords(THERMOSTAT)).toBe(THERMOSTAT);
  });
});

describe("rowsForQuestion", () => {
  it("withholds defaults from a manager asking about their own password (the 1★ password question's first turn)", () => {
    const [shown] = rowsForQuestion("How can I change my password", [row(NEW_HIRE_SECTION)]);
    expect(shown!.content).not.toContain("*example1");
    expect(shown!.chunk_id).toBe("c1");
  });

  it.each([
    "I'm a new hire, how do I change my password?",
    "on my first day I couldn't log in",
    "How can I change my password",
  ])("withholds them for %j, which is about the asker's own password", (question) => {
    expect(asksForDefaultCredentials(question)).toBe(false);
  });

  it.each([
    "How do new hires set up their SunLync password?",
    "What is the default password for MyGlow?",
    "walk me through onboarding a new employee's logins",
  ])("keeps them for %j", (question) => {
    expect(asksForDefaultCredentials(question)).toBe(true);
    const [shown] = rowsForQuestion(question, [row(NEW_HIRE_SECTION)]);
    expect(shown!.content).toBe(NEW_HIRE_SECTION);
  });

  it("returns an untouched row unchanged", () => {
    const plain = row("Dress code: skirts must reach the knee.");
    expect(rowsForQuestion("what is the dress code", [plain])[0]).toBe(plain);
  });
});
