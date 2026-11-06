import sqlite3,sys
from dump import walk
typ=int(sys.argv[1])
c=sqlite3.connect('file:C:/Users/sxbdg/AppData/Local/Temp/agsess/s.db?mode=ro',uri=True)
rows=c.execute('select idx,step_payload from steps where step_type=? and step_payload is not null order by idx limit 2',(typ,)).fetchall()
for idx,p in rows:
    print('--- idx',idx,'len',len(p))
    for path,d,s in walk(p)[:30]:
        print('  ',path, repr(s[:200]))
