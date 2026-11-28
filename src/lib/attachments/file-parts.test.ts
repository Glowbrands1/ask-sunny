import { describe, expect, it } from "vitest";

import { MAX_MESSAGE_SEND_BYTES, attachmentProblem, filesThatFit, sentBytes } from "./file-parts";

/**
 * WHAT A MESSAGE CAN CARRY (audit, 28 Nov 2026). The composer accepted any file under 10 MB, but files go to /api/chat
 * inside the request as base64 and Vercel refuses a request over about 4.5 MB with a bare 413: a 4 MB PDF was
 * accepted and could never be sent. Images are shrunk in the browser; other files are not.
 */
const MB = 1024 * 1024;
const file = (name: string, type: string, size: number) => ({ name, type, size }) as unknown as File;

describe("the chat composer only takes what the server can receive", () => {
  it("refuses a PDF too large to send, saying so before anything is sent", () => {
    expect(attachmentProblem(file("policy.pdf", "application/pdf", 4 * MB), "chat")).toMatch(/too large to send in the chat/);
  });

  it("takes a 2 MB PDF, and a large photo (it is shrunk in the browser)", () => {
    expect(attachmentProblem(file("policy.pdf", "application/pdf", 2 * MB), "chat")).toBeUndefined();
    expect(attachmentProblem(file("photo.jpg", "image/jpeg", 8 * MB), "chat")).toBeUndefined();
    expect(sentBytes(file("photo.jpg", "image/jpeg", 8 * MB))).toBeLessThanOrEqual(1_500_000);
  });

  it("stops adding files once the message would be too large, and names the one that does not fit", () => {
    const already = [file("a.pdf", "application/pdf", 1 * MB)];
    const { fit, problems } = filesThatFit(already, [file("photo.jpg", "image/jpeg", 6 * MB), file("b.pdf", "application/pdf", 1 * MB)]);
    expect(fit.map((f) => f.name)).toEqual(["photo.jpg"]);
    expect(problems).toEqual(["b.pdf would make this message too large to send. Send it in a message of its own."]);
    const total = [...already, ...fit].reduce((sum, f) => sum + sentBytes(f), 0);
    expect(total).toBeLessThanOrEqual(MAX_MESSAGE_SEND_BYTES);
  });

  it("the L10 panel's limits are unchanged", () => {
    expect(attachmentProblem(file("big.pdf", "application/pdf", 4 * MB))).toBeUndefined();
  });
});
