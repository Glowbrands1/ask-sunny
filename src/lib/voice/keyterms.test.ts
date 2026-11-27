import { describe, expect, it, vi } from "vitest";

import { MAX_KEYTERMS, MAX_KEYTERM_CHARACTERS, boundKeyterms, chatVoiceHints, l10VoiceHints, rosterNamesUsed, type ChatHintDeps, type L10HintDeps } from "./keyterms";
import type { RosterEmployee } from "@/lib/forms/employee-match";
import type { AccessScope, ChatMessage } from "@/types";

/*
 * VOICE_INPUT_ENABLED: spelling hints, built on the server from the app's own data. Every person here is invented.
 */

const SCOPE: AccessScope = { level: "salon", primaryAreaId: "loc-0001", alsoCoversAreaIds: [] };
const ACTOR = { userId: "user-ada", role: "salon_director" as const, scope: SCOPE };
const CONVERSATION = "conv_mvn0000000000aaaa";

const ROSTER: RosterEmployee[] = [
  { id: "e1", firstName: "Orla", lastName: "Fennick", preferredFirstName: null, salonIds: ["loc-0001"] },
  { id: "e2", firstName: "Thaddeus", lastName: "Brook", preferredFirstName: "Tad", salonIds: ["loc-0001"] },
  { id: "e3", firstName: "Mira", lastName: "Castellane", preferredFirstName: null, salonIds: ["loc-0001"] },
];

const message = (role: "user" | "assistant", content: string): ChatMessage => ({ id: `m-${content.length}`, role, content, createdAt: "2026-11-27T01:00:00Z" });

function chatDeps(over: Partial<ChatHintDeps> = {}): ChatHintDeps & { ownConversation: ReturnType<typeof vi.fn> } {
  return {
    ownConversation: vi.fn(async (userId: string, conversationId: string) =>
      userId === "user-ada" && conversationId === CONVERSATION
        ? [message("user", "I need a coaching form for tad brook, he was late again"), message("assistant", "Here is a Coaching Form for Thaddeus Brook (orla.f@example.test, id e1).")]
        : null,
    ),
    scopedRoster: vi.fn(async () => ROSTER),
    publishedFormNames: vi.fn(async () => ["Coaching Form", "Corrective Action Form", "Exit Form"]),
    salonName: () => "Example Plaza",
    ...over,
  } as ChatHintDeps & { ownConversation: ReturnType<typeof vi.fn> };
}

describe("boxes A, B and C", () => {
  it("names this conversation used (and on the roster), then the published forms, then the salon", async () => {
    const hints = await chatVoiceHints({ actor: ACTOR, conversationId: CONVERSATION }, chatDeps());
    expect(hints.keyterms).toEqual(["Tad Brook", "Thaddeus Brook", "Coaching Form", "Corrective Action Form", "Exit Form", "Example Plaza"]);
    expect(hints.prompt).toMatch(/manager is speaking/);
    expect(hints.conversationContext).toHaveLength(2);
  });

  it("never the whole roster: a roster name the conversation did not use is not sent", async () => {
    const hints = await chatVoiceHints({ actor: ACTOR, conversationId: CONVERSATION }, chatDeps());
    expect(hints.keyterms).not.toContain("Orla Fennick");
    expect(hints.keyterms).not.toContain("Mira Castellane");
  });

  it("a name the conversation used that is not on the roster is not sent", async () => {
    const deps = chatDeps({ ownConversation: vi.fn(async () => [message("user", "what about Zebulon Quarry from the other company")]) as ChatHintDeps["ownConversation"] });
    const hints = await chatVoiceHints({ actor: ACTOR, conversationId: CONVERSATION }, deps);
    expect(hints.keyterms.join(" ")).not.toMatch(/Zebulon|Quarry/);
  });

  it("no emails or ids", async () => {
    const hints = await chatVoiceHints({ actor: ACTOR, conversationId: CONVERSATION }, chatDeps());
    const all = hints.keyterms.join("\n");
    expect(all).not.toMatch(/@/);
    expect(hints.keyterms).not.toContain("e1");
    expect(all).not.toMatch(/loc-0001/);
  });

  it("a conversation id that is not the person's own is ignored: no names, no context", async () => {
    const deps = chatDeps();
    const hints = await chatVoiceHints({ actor: ACTOR, conversationId: "conv_mvn0000000000zzzz" }, deps);
    expect(deps.ownConversation).toHaveBeenCalledWith("user-ada", "conv_mvn0000000000zzzz");
    expect(hints.keyterms).toEqual(["Coaching Form", "Corrective Action Form", "Exit Form", "Example Plaza"]);
    expect(hints).not.toHaveProperty("conversationContext");
    expect(deps.scopedRoster).not.toHaveBeenCalled();
  });

  it("no conversation id: forms and salon only, and the history is not read", async () => {
    const deps = chatDeps();
    const hints = await chatVoiceHints({ actor: ACTOR }, deps);
    expect(deps.ownConversation).not.toHaveBeenCalled();
    expect(hints.keyterms).toEqual(["Coaching Form", "Corrective Action Form", "Exit Form", "Example Plaza"]);
  });

  it("only database-sourced terms: the input has no field for a browser term", async () => {
    // The only browser-sent value that reaches here is the conversation id, and it is used only to look up the
    // person's own history on the server.
    const hints = await chatVoiceHints({ actor: ACTOR, conversationId: CONVERSATION, keyterms: ["Injected Term"] } as never, chatDeps());
    expect(hints.keyterms).not.toContain("Injected Term");
  });

  it("a reader that fails leaves its part out, never the whole hint list", async () => {
    const hints = await chatVoiceHints(
      { actor: ACTOR, conversationId: CONVERSATION },
      chatDeps({ publishedFormNames: async () => Promise.reject(new Error("down")), scopedRoster: async () => Promise.reject(new Error("down")) }),
    );
    expect(hints.keyterms).toEqual(["Example Plaza"]);
  });
});

describe("box D (the L10 assistant)", () => {
  const l10Deps = (over: Partial<L10HintDeps> = {}): L10HintDeps => ({
    meeting: vi.fn(async (key: string) => (key === "stc-dm" ? { name: "DM L10", people: ["Orla Fennick", "Ivo Marchetti", "Orla Fennick"] } : null)),
    salonName: () => "Example Plaza",
    ...over,
  });

  it("the meeting's people, then its name, then the salon; no conversation context", async () => {
    const hints = await l10VoiceHints({ meetingKey: "stc-dm", scope: SCOPE }, l10Deps());
    expect(hints.keyterms).toEqual(["Orla Fennick", "Ivo Marchetti", "DM L10", "Example Plaza"]);
    expect(hints.prompt).toMatch(/leadership L10 meeting \(DM L10\)/);
    expect(hints).not.toHaveProperty("conversationContext");
  });

  it("a meeting the Hub does not return: the salon only", async () => {
    const hints = await l10VoiceHints({ meetingKey: "stc-sd-one", scope: SCOPE }, l10Deps());
    expect(hints.keyterms).toEqual(["Example Plaza"]);
  });
});

describe("the bounds", () => {
  it("at most 100 terms and 8,000 characters, duplicates removed, terms over six words dropped", () => {
    const many = Array.from({ length: 150 }, (_, i) => `Person Number${i}`);
    expect(boundKeyterms(many)).toHaveLength(MAX_KEYTERMS);
    const long = Array.from({ length: 100 }, (_, i) => `${"x".repeat(95)}${String(i).padStart(4, "0")}`);
    const bounded = boundKeyterms(long);
    expect(bounded.join("").length).toBeLessThanOrEqual(MAX_KEYTERM_CHARACTERS);
    expect(bounded.length).toBeLessThan(100);
    expect(boundKeyterms(["Ada Quill", "ada quill", "  Ada   Quill ", "one two three four five six seven", "", null])).toEqual(["Ada Quill"]);
  });

  it("matches whole names only, in the order the conversation used them", () => {
    expect(rosterNamesUsed([message("user", "mira castellanes and orla fennick")], ROSTER)).toEqual(["Orla Fennick"]);
    expect(rosterNamesUsed([message("user", "Orla Fennick then Mira Castellane")], ROSTER)).toEqual(["Orla Fennick", "Mira Castellane"]);
  });
});
