"""Greedy minimal flag set that still reproduces a change.
python3 -I minimize.py <file> <-t pattern> <mode: test|record> <record-key-or-test-substring> <off-shape-file-or-'-'> FLAG,FLAG,...
For mode=test: 'changed' = the matching test fails. For mode=record: the record for key differs from the OFF record (given as a JSON-lines file)."""
import json, os, subprocess, sys, tempfile

file, pattern, mode, key, offfile, flags = sys.argv[1:7]
flags = flags.split(",")
S = os.environ["GATE_SCRATCH"]
tmp = tempfile.mkdtemp(dir=S)
shape = lambda r: json.dumps({"ok": r["ok"], "turns": r["turns"]}) if r else "absent"
off = None
if mode == "record":
    for l in open(offfile):
        r = json.loads(l)
        if f"{r['id']} [{r['mode']}]" == key:
            off = shape(r)


def changed(on):
    rep, rec = os.path.join(tmp, "r.json"), os.path.join(tmp, "r.jsonl")
    for p in (rep, rec):
        if os.path.exists(p):
            os.remove(p)
    env = {"PATH": os.environ["PATH"], "HOME": os.environ["HOME"], "TMPDIR": tmp, "LANG": "C.UTF-8", "NODE_ENV": "test",
           "CHAT_GLOSSARY_ENABLED": "true", "FLAG_CLASSIFY_ON": ",".join(["CHAT_GLOSSARY_ENABLED", *on]), "REPLAY_RECORD": rec}
    env.update({f: "true" for f in on})
    subprocess.run([sys.executable if False else "node", "node_modules/vitest/vitest.mjs", "run", "--reporter=json", f"--outputFile={rep}", file, "-t", pattern],
                   cwd=os.environ["GATE_TREE"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if mode == "test":
        d = json.load(open(rep))
        st = [t["status"] for f in d["testResults"] for t in f["assertionResults"] if key in t["fullName"]]
        return "failed" in st
    for l in open(rec) if os.path.exists(rec) else []:
        r = json.loads(l)
        if f"{r['id']} [{r['mode']}]" == key:
            return shape(r) != off
    return False


assert changed(flags), "the full set does not reproduce the change"
keep = list(flags)
for f in flags:
    trial = [x for x in keep if x != f]
    if changed(trial):
        keep = trial
print("MINIMAL:", ",".join(x.replace("_ENABLED", "") for x in keep))
