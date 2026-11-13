# Adds draft (D:), revision (R:) and Step B patch (P:) system-prompt hashes to REPLAY_RECORD's "systems".
# Usage: python3 hash-prompts.py <worktree>; run the replay pack with REPLAY_RECORD; revert with git checkout.
import sys
p=sys.argv[1]+'/src/app/api/chat/replay-pack/replay-pack-e2e.test.ts'; s=open(p).read()
a="""      create: async (request: { tool_choice?: { name?: string } }) => {
        const revising = request.tool_choice?.name === "revise_form_fields";"""
assert a in s
s=s.replace(a, a+"""
        { const sys = (request as { system?: unknown }).system; const txt = typeof sys === "string" ? sys : JSON.stringify(sys ?? ""); if (process.env.REPLAY_RECORD) systemPrompts.hashes.push((revising ? "R:" : "D:") + createHash("sha256").update(txt).digest("hex").slice(0, 16)); }""",1)
b="""  callFormPatchModel: async (input?: { prompt?: string }) => {"""
assert b in s
s=s.replace(b, """  callFormPatchModel: async (input?: { prompt?: string; system?: string }) => {
    if (process.env.REPLAY_RECORD) systemPrompts.hashes.push("P:" + createHash("sha256").update(String(input?.system ?? "")).digest("hex").slice(0, 16));""",1)
open(p,'w').write(s)
