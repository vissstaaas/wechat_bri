import sqlite3, sys

def read_varint(b, i):
    r = 0; s = 0
    while True:
        if i >= len(b): raise ValueError('eof')
        c = b[i]; i += 1
        r |= (c & 0x7f) << s
        if not (c & 0x80): return r, i
        s += 7
        if s > 63: raise ValueError('varint too long')

def try_parse(b):
    out = []
    i = 0
    while i < len(b):
        try:
            key, i = read_varint(b, i)
        except ValueError:
            return None
        fn = key >> 3; wt = key & 7
        if fn == 0 or fn > 100000: return None
        if wt == 0:
            try: v, i = read_varint(b, i)
            except ValueError: return None
            out.append((fn, 0, v))
        elif wt == 1:
            if i + 8 > len(b): return None
            out.append((fn, 1, b[i:i+8])); i += 8
        elif wt == 2:
            try: ln, i = read_varint(b, i)
            except ValueError: return None
            if ln < 0 or i + ln > len(b): return None
            out.append((fn, 2, b[i:i+ln])); i += ln
        elif wt == 5:
            if i + 4 > len(b): return None
            out.append((fn, 5, b[i:i+4])); i += 4
        else:
            return None
    return out if out else None

def printable(s):
    if not s: return False
    ok = sum(1 for ch in s if ch.isprintable() or ch in '\n\t')
    return ok / len(s) > 0.95

def walk(b, depth=0, out=None, fnpath=()):
    if out is None: out = []
    msg = try_parse(b)
    if msg is None:
        return out
    for fn, wt, v in msg:
        if wt == 2:
            sub = try_parse(v) if len(v) >= 2 else None
            if sub is not None:
                walk(v, depth+1, out, fnpath+(fn,))
            else:
                try:
                    s = v.decode('utf-8')
                except UnicodeDecodeError:
                    continue
                if printable(s) and len(s.strip()) > 1:
                    out.append((fnpath+(fn,), depth+1, s))
    return out

if __name__ == '__main__':
    db = sys.argv[1]
    start = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    end = int(sys.argv[3]) if len(sys.argv) > 3 else 10**9
    lim = int(sys.argv[4]) if len(sys.argv) > 4 else 400
    c = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
    rows = c.execute('select idx, step_type, step_payload from steps where idx>=? and idx<=? order by idx', (start, end)).fetchall()
    for idx, st, p in rows:
        if not p: continue
        ss = walk(p)
        if not ss: continue
        print(f'===== STEP {idx} (type {st}) =====')
        for path, d, s in ss:
            s2 = s.replace('\r', '')
            if len(s2) > lim: s2 = s2[:lim] + f'…[{len(s)}]'
            print(f'  [{".".join(map(str,path))}] {s2}')
