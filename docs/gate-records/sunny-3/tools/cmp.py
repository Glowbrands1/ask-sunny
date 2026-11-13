import re
import json,sys,collections
def load(p):
    d=json.load(open(p)); r={}
    for f in d['testResults']:
        for a in f['assertionResults']:
            r[(re.sub(r'^/home/user/[^/]+/','',f['name']), a['fullName'])]=a['status']
    return d,r
def rec(p):
    m={}
    for l in open(p):
        try: j=json.loads(l)
        except: continue
        k=(j['id'],j['mode'])
        if k in m: continue  # first occurrence (main suite run)
        m[k]=j
    return m
A,B=sys.argv[1],sys.argv[2]
da,ra=load(S+'/'+A+'.json') if (S:=sys.argv[3]) else None
db,rb=load(S+'/'+B+'.json')
for n,d in((A,da),(B,db)):
    print(n,'tests',d['numTotalTests'],'pass',d['numPassedTests'],'fail',d['numFailedTests'],'pending',d['numPendingTests'],'suitesFail',d['numFailedTestSuites'])
keys=set(ra)|set(rb)
ch=[(k,ra.get(k),rb.get(k)) for k in sorted(keys) if ra.get(k)!=rb.get(k)]
print('status changes:',len(ch))
for k,a,b in ch: print(' ',a,'->',b,'|',k[0],'|',k[1][:220])
for n,r in((A,ra),(B,rb)):
    f=[k for k,v in r.items() if v=='failed']
    print(n,'failed:',len(f))
    for k in f[:30]: print('   ',k[0],'|',k[1][:200])
ma,mb=rec(S+'/'+A+'.jsonl'),rec(S+'/'+B+'.jsonl')
print('replay records',len(ma),len(mb))
# compare text of replay by case id, matching production/open mode records
def byid(m):
    o=collections.defaultdict(dict)
    for (i,mode),j in m.items(): o[i][mode]=j
    return o
oa,ob=byid(ma),byid(mb)
diff=[]
for i in sorted(set(oa)|set(ob)):
    for mode in sorted(set(oa.get(i,{}))|set(ob.get(i,{}))):
        x=oa.get(i,{}).get(mode); y=ob.get(i,{}).get(mode)
        if x is None or y is None: diff.append((i,mode,'missing',x is None,y is None)); continue
        if json.dumps(x['turns'])!=json.dumps(y['turns']) or x['ok']!=y['ok'] or x['systems']!=y['systems']:
            diff.append((i,mode,'ok %s->%s'%(x['ok'],y['ok']),'turns same' if x['turns']==y['turns'] else 'turns differ','sys same' if x['systems']==y['systems'] else 'sys differ'))
print('replay text diffs:',len(diff))
for d in diff: print('  ',d)
