import sqlite3, sys
from dump import walk
c=sqlite3.connect('file:C:/Users/sxbdg/AppData/Local/Temp/agsess/s.db?mode=ro',uri=True)
rows=c.execute('select idx,step_type,step_payload from steps order by idx').fetchall()
mode=sys.argv[1]
if mode=='user':
    for idx,st,p in rows:
        if st!=14 or not p: continue
        for path,d,s in walk(p):
            if path==(19,2):
                print(f'--- idx {idx} ---')
                print(s)
                print()
elif mode=='summary':
    idxs=[(idx,p) for idx,st,p in rows if st==23 and p]
    idx,p=idxs[-1]
    print('checkpoint idx',idx,'of',len(idxs))
    for path,d,s in walk(p):
        if path==(30,5):
            print(s)
elif mode=='count':
    from collections import Counter
    print(Counter(st for _,st,_ in rows))
