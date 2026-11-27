import { describe, expect, it, vi } from "vitest";

import { MAX_KEYTERMS, MAX_KEYTERM_CHARACTERS, boundKeyterms, chatVoiceHints, l10VoiceHints, rosterNamesUsed, type ChatHintDeps, type L10HintDeps } from "./keyterms";
import type { RosterEmployee } from "@/lib/forms/employee-match";
import type { AccessScope, ChatMessage } from "@/types";

/*
 * VOICE_INPUT_ENABLED: spelling hints, built on the server from the app's own data. Every person here is invented.
 *
 * CHANGED ON PURPOSE (the owner, 27 Nov 2026: "i said Curt, it spelled it as Kurt"; "make sure sunny ... know the
 * spelling of all employee"; "also salon names too"). These used to pin that a staff name was a hint only once the
 * conversation had used it, so the first time a name was said nothing told the provider its spelling. The scoped
 * roster and the scope's salons are now hints too, after the conversation's own names. What has NOT changed is pinned
 * as before: nobody outside the scoped roster, no browser-sent term, no emails or ids, a failing reader drops only its
 * own part.
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
    scopedPlaces: () => [{ id: "loc-0001", names: ["Example Plaza", "The Plaza"] }],
    ...over,
  } as ChatHintDeps & { ownConversation: ReturnType<typeof vi.fn> };
}

describe("boxes A, B and C", () => {
  it("names this conversation used, then the salons, then the published forms, then the scoped roster", async () => {
    const hints = await chatVoiceHints({ actor: ACTOR, conversationId: CONVERSATION }, chatDeps());
    expect(hints.keyterms).toEqual([
      "Tad Brook",
      "Thaddeus Brook",
      "Example Plaza",
      "The Plaza",
      "Coaching Form",
      "Corrective Action Form",
      "Exit Form",
      "Orla Fennick",
      "Mira Castellane",
      "Orla",
      "Tad",
      "Thaddeus",
      "Mira",
    ]);
    expect(hints.prompt).toMatch(/manager is speaking/);
    expect(hints.conversationContext).toHaveLength(2);
  });

  it("the scoped roster is read for this person's scope, and its people are hints before any name is said", async () => {
    const deps = chatDeps();
    const hints = await chatVoiceHints({ actor: ACTOR }, deps);
    expect(deps.scopedRoster).toHaveBeenCalledWith(SCOPE);
    expect(hints.keyterms).toContain("Orla Fennick");
    expect(hints.keyterms).toContain("Mira Castellane");
  });

  it("the vocabulary the transcript is corrected against is the same scoped people and salons", async () => {
    const hints = await chatVoiceHints({ actor: ACTOR }, chatDeps());
    expect(hints.vocabulary?.exact.has("fennick")).toBe(true);
    expect(hints.vocabulary?.exact.has("plaza")).toBe(true);
    expect(hints.vocabulary?.exact.has("zebulon")).toBe(false);
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
    expect(hints.keyterms.slice(0, 5)).toEqual(["Example Plaza", "The Plaza", "Coaching Form", "Corrective Action Form", "Exit Form"]);
    expect(hints).not.toHaveProperty("conversationContext");
  });

  it("no conversation id: the history is not read", async () => {
    const deps = chatDeps();
    const hints = await chatVoiceHints({ actor: ACTOR }, deps);
    expect(deps.ownConversation).not.toHaveBeenCalled();
    expect(hints.keyterms.slice(0, 5)).toEqual(["Example Plaza", "The Plaza", "Coaching Form", "Corrective Action Form", "Exit Form"]);
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
    expect(hints.keyterms).toEqual(["Example Plaza", "The Plaza"]);
  });
});

describe("box D (the L10 assistant)", () => {
  const l10Deps = (over: Partial<L10HintDeps> = {}): L10HintDeps => ({
    meeting: vi.fn(async (key: string) => (key === "stc-dm" ? { name: "DM L10", people: ["Orla Fennick", "Ivo Marchetti", "Orla Fennick"] } : null)),
    salonName: () => "Example Plaza",
    scopedRoster: async () => [],
    scopedPlaces: () => [],
    ...over,
  });

  it("the meeting's people, then its name, then the salon; no conversation context", async () => {
    const hints = await l10VoiceHints({ meetingKey: "stc-dm", scope: SCOPE }, l10Deps());
    expect(hints.keyterms).toEqual(["Orla Fennick", "Ivo Marchetti", "DM L10", "Example Plaza"]);
    expect(hints.prompt).toMatch(/leadership L10 meeting \(DM L10\)/);
    expect(hints).not.toHaveProperty("conversationContext");
  });

  it("then the scope's salons and people, and the meeting's people are in the vocabulary", async () => {
    const hints = await l10VoiceHints(
      { meetingKey: "stc-dm", scope: SCOPE },
      l10Deps({ scopedRoster: async () => ROSTER, scopedPlaces: () => [{ id: "loc-0001", names: ["Example Plaza"] }] }),
    );
    expect(hints.keyterms.slice(0, 4)).toEqual(["Orla Fennick", "Ivo Marchetti", "DM L10", "Example Plaza"]);
    expect(hints.keyterms).toContain("Mira Castellane");
    expect(hints.vocabulary?.exact.has("marchetti")).toBe(true);
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
