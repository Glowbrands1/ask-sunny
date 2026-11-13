import json,sys,difflib,collections
S,A,B=sys.argv[1:4]
def load(p):
    m={}
    for l in open(p):
        j=json.loads(l); k=(j['id'],j['mode'])
        if k not in m: m[k]=j
    return m
a,b=load(f"{S}/{A}.jsonl"),load(f"{S}/{B}.jsonl")
sig=collections.defaultdict(list)
for k in sorted(set(a)&set(b)):
    ta=json.dumps(a[k]['turns']); tb=json.dumps(b[k]['turns'])
    if ta==tb: continue
    sm=difflib.SequenceMatcher(None,ta,tb,autojunk=False)
    parts=[]
    for op,i1,i2,j1,j2 in sm.get_opcodes():
        if op!='equal': parts.append(f"{op}: -[{ta[i1:i2][:200]}] +[{tb[j1:j2][:200]}]")
    s=' || '.join(parts)[:600]
    sig[s].append(k)
for s,ks in sorted(sig.items(),key=lambda x:-len(x[1])):
    print(len(ks),'x', ks[0], '\n   ', s)
