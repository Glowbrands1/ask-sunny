import json,sys,difflib
S,A,B,cid,mode=sys.argv[1:6]
def g(p):
    for l in open(p):
        j=json.loads(l)
        if j['id']==cid and j['mode']==mode: return j
a=g(f"{S}/{A}.jsonl");b=g(f"{S}/{B}.jsonl")
ta=json.dumps(a['turns'],indent=1).splitlines();tb=json.dumps(b['turns'],indent=1).splitlines()
for l in difflib.unified_diff(ta,tb,lineterm='',n=0):
    print(l[:700])
