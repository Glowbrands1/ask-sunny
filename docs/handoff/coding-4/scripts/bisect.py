import json,subprocess,os
S="/tmp/claude-0/-home-user/8434bb36-e5b0-5e70-a507-3dc0859d7025/scratchpad"
d=json.load(open("src/config/production-flags.json"))
prod=d["on"]+d["assumedOn"]
def bad(drop):
    env=dict(os.environ,PROBE_DROP=",".join(drop),PROBE_OUT=S+"/bis.txt")
    subprocess.run(["npx","vitest","run","src/app/api/chat/replay-pack/replay-pack-e2e.test.ts","-t","zz-probe"],env=env,capture_output=True)
    return '"formDate": "2026-09-15"' in open(S+"/bis.txt").read()
assert bad([])
# find minimal set of flags whose removal fixes: assume single culprit, binary search on 'dropping these fixes it'
cand=prod[:]
while len(cand)>1:
    half=cand[:len(cand)//2]
    if not bad(half): cand=half
    else:
        rest=cand[len(cand)//2:]
        if not bad(rest): cand=rest
        else: print("both halves needed / multiple:",len(cand)); break
print("culprit(s):",cand if len(cand)<10 else len(cand))
