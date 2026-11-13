import json,re,collections,sys
S,A,B=sys.argv[1:4]
def load(p):
    m={}
    for l in open(p):
        j=json.loads(l);k=(j['id'],j['mode'])
        if k not in m: m[k]=j
    return m
a,b=load(f"{S}/{A}.jsonl"),load(f"{S}/{B}.jsonl")
KEY=re.compile(r'^(\*\*(Policy|Date|Job title|Observation of Offense|Action Plan|Type of Warning|Prior|Payroll|Location|Name|Last Day|Details)[^*]*:\*\*|.*Policy, JBA Policy Manual p\.|.*[Pp]ayroll deduct|Create the draft here|.*won.t guess|One more question)')
removed=collections.Counter(); added=collections.Counter(); keylost=[]; nonfirst=0; first_changed=[]
for k in a:
    if k not in b: continue
    ta,tb=a[k]['turns'],b[k]['turns']
    for i,(x,y) in enumerate(zip(ta,tb)):
        rx,ry=x.get('reply') or '',y.get('reply') or ''
        if rx==ry: continue
        lx=[l for l in rx.split('\n') if l.strip()]; ly=[l for l in ry.split('\n') if l.strip()]
        kx=[l for l in lx if KEY.match(l)]; ky=[l for l in ly if KEY.match(l)]
        if kx!=ky: keylost.append((k,i,[l for l in kx if l not in ky][:3],[l for l in ky if l not in kx][:3]))
        for l in lx:
            if l not in ly: removed[re.sub(r'\*\*[^*]+\*\*','<B>',l)[:110]]+=1
        for l in ly:
            if l not in lx: added[re.sub(r'\*\*[^*]+\*\*','<B>',l)[:110]]+=1
        # was this the first card turn in the chat? (no earlier reply with a card lead)
        earlier=[t.get('reply') or '' for t in ta[:i]]
        if not any("I'll draft" in e or "Here's what I'll fill in" in e for e in earlier): first_changed.append((k,i))
print('changed replies with KEY-line differences:',len(keylost))
for e in keylost[:12]: print('  ',e[0][0],e[0][1][:30],'turn',e[1],'\n     OFF-only:',e[2],'\n     ON-only :',e[3])
print('changed replies that are the FIRST card turn:',len(first_changed), first_changed[:8])
print('TOP removed:'); [print('  ',n,r) for r,n in removed.most_common(10)]
print('TOP added:'); [print('  ',n,r) for r,n in added.most_common(10)]
