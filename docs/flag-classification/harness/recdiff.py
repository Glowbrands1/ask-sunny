import json,glob,os,re,sys,collections
import os; R=os.environ["GATE_R"]
def load(p): return {(r['id'],r['mode']):r for r in map(json.loads,open(p))}
off=load(R+'/off-1.replay.jsonl')
def paras(s): return [p.strip() for p in re.split(r'\n\s*\n',s or '') if p.strip()]
def short(p): return re.sub(r'\s+',' ',p)[:150]
units=sys.argv[1:] or [os.path.basename(p)[:-6] for p in sorted(glob.glob(R+'/bis/*.jsonl'))]
for u in units:
    s=load(f'{R}/bis/{u}.jsonl'); seen=set(); n=0; okflip=0
    out=[]
    for k,ra in off.items():
        rb=s.get(k)
        if not rb: continue
        ch=[]
        for j,(x,y) in enumerate(zip(ra['turns'],rb['turns'])):
            if x['reply']!=y['reply']:
                pa,pb=paras(x['reply']),paras(y['reply'])
                rem=[short(p) for p in pa if p not in pb]; add=[short(p) for p in pb if p not in pa]
                ch.append((j+1,rem,add))
        if ch or ra['ok']!=rb['ok']:
            n+=1
            if ra['ok']!=rb['ok']: okflip+=1
            if k[1]=='production' or k[0] not in {a for a,b in s if b=='production'}: out.append((k,ra['ok'],rb['ok'],ch))
    print(f'\n######## {u}: changed records {n} (ok flips {okflip}); shown {len(out)}')
    for k,a,b,ch in out:
        print(f'- {k[0]} [{k[1][:30]}] ok {a}->{b}')
        for j,rem,add in ch[:3]:
            print(f'    t{j} -: {rem[:3]}'); print(f'    t{j} +: {add[:3]}')
