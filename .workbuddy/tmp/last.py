import sqlite3,sys
from dump import walk
c=sqlite3.connect('file:C:/Users/sxbdg/AppData/Local/Temp/agsess/s.db?mode=ro',uri=True)
rows=c.execute('select idx,step_type,step_payload from steps where idx>=? order by idx',(int(sys.argv[1]),)).fetchall()
for idx,st,p in rows:
    if st not in (14,15) or not p: continue
    for path,d,s in walk(p):
        if st==14 and path==(19,2):
            print(f'### USER idx{idx}:', s[:600]); print()
        if st==15 and path==(20,1):
            print(f'### BOT idx{idx}:', s[:2500]); print()
