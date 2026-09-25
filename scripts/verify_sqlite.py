"""Cross-check the visualizer's relational algebra engine against SQLite.

Every slide preset (and some extra custom queries) is run through the TypeScript engine
and through an equivalent hand-written SQL query; the result sets must be identical.
The queries in scripts/fixtures/csv-cases.json do the same over imported CSV files: the engine
imports them with src/engine/csv.ts, and SQLite gets them from Python's own csv reader.
Run:  python3 scripts/verify_sqlite.py   (uses bun if installed, otherwise `npx tsx`)
"""
import csv, json, os, re, shutil, sqlite3, subprocess, sys

MOVIES = [(1,'Shining','Kubrick',1980,146),(2,'Player','Altman',1992,146),(3,'Chinatown','Polaski',1974,131),
          (4,'Repulsion','Polaski',1965,143),(5,'Star Wars IV','Lucas',1977,126),(6,'American Graffiti','Lucas',1973,110),
          (7,'Full Metal Jacket','Kubrick',1987,156)]
ARTISTS = [(1,'Nicholson','American'),(2,'Ford','American'),(3,'Stone','British'),(4,'Fisher','American')]
BACHCHAN = (5,'Bachchan','Indian')
ROLES = [(1,1,'Jack Torrance'),(3,1,"Jake 'J.J.' Gittes"),(1,3,'Delbert Grady'),(5,2,'Han Solo'),(6,2,'Bob Falfa'),(5,4,'Princess Leia Organa')]
R1 = [('a',1),('b',2)]
R2 = [(1,'x'),(1,'y'),(3,'z')]

def db(bachchan):
    c = sqlite3.connect(':memory:')
    c.execute('CREATE TABLE Movies(mID, title, director, year, length)')
    c.execute('CREATE TABLE Artists(aID, aName, nationality)')
    c.execute('CREATE TABLE Roles(mID, aID, character)')
    c.execute('CREATE TABLE R1(col0, col1)')
    c.execute('CREATE TABLE R2(col1, col2)')
    c.executemany('INSERT INTO Movies VALUES (?,?,?,?,?)', MOVIES)
    c.executemany('INSERT INTO Artists VALUES (?,?,?)', ARTISTS + ([BACHCHAN] if bachchan else []))
    c.executemany('INSERT INTO Roles VALUES (?,?,?)', ROLES)
    c.executemany('INSERT INTO R1 VALUES (?,?)', R1)
    c.executemany('INSERT INTO R2 VALUES (?,?)', R2)
    return c

# id -> (SQL, bachchan or None to use the preset's setting, custom RA query or None)
CASES = {
  'natural-basic': ('SELECT DISTINCT col0, col1, col2 FROM R1 NATURAL JOIN R2', None, None),
  'left-basic':    ('SELECT DISTINCT col0, col1, col2 FROM R1 NATURAL LEFT JOIN R2', None, None),
  'right-basic':   ('SELECT DISTINCT R1.col0, R2.col1, R2.col2 FROM R1 RIGHT JOIN R2 ON R1.col1 = R2.col1', None, None),
  'full-basic':    ('SELECT DISTINCT R1.col0, COALESCE(R1.col1, R2.col1), R2.col2 FROM R1 FULL JOIN R2 ON R1.col1 = R2.col1', None, None),
  'q1-product':    ('SELECT DISTINCT * FROM Artists, Roles', None, None),
  'q2-natural':    ('SELECT DISTINCT aID, aName, nationality, mID, character FROM Artists NATURAL JOIN Roles', None, None),
  'q3-kubrick':    ("SELECT DISTINCT aName FROM Artists NATURAL JOIN Roles NATURAL JOIN Movies WHERE director = 'Kubrick'", None, None),
  'q4-kubrick':    ("SELECT DISTINCT aName FROM (SELECT * FROM Movies WHERE director = 'Kubrick') NATURAL JOIN Roles NATURAL JOIN Artists", None, None),
  'british':       ("SELECT DISTINCT aName FROM Artists WHERE nationality = 'British'", None, None),
  '70s-product':   ('SELECT DISTINCT character FROM Movies, Roles WHERE Movies.mID = Roles.mID AND year >= 1970 AND year <= 1979', None, None),
  '70s-natural':   ('SELECT DISTINCT character FROM Movies NATURAL JOIN Roles WHERE year >= 1970 AND year <= 1979', None, None),
  'theta':         ('SELECT DISTINCT * FROM Movies JOIN Roles ON Movies.mID = Roles.mID', None, None),
  'dangling':      ('SELECT DISTINCT aID, aName, nationality, mID, character FROM Artists NATURAL JOIN Roles', None, None),
  'outer-artists': ('SELECT DISTINCT aID, aName, nationality, mID, character FROM Artists NATURAL LEFT JOIN Roles', None, None),
  'self-join':     ('SELECT DISTINCT a1.aName, a2.aName FROM Artists a1, Artists a2 WHERE a1.nationality = a2.nationality AND a1.aID < a2.aID', None, None),
  # Extra custom queries a student might type
  'x-roles-right-artists': ('SELECT DISTINCT r.mID, COALESCE(r.aID, a.aID), r.character, a.aName, a.nationality FROM Roles r RIGHT JOIN Artists a ON r.aID = a.aID',
                            True, 'Roles ⟖ Artists'),
  'x-movies-full-roles':   ('SELECT DISTINCT COALESCE(m.mID, r.mID), m.title, m.director, m.year, m.length, r.aID, r.character FROM Movies m FULL JOIN Roles r ON m.mID = r.mID',
                            True, 'Movies ⟗ Roles'),
  'x-long-full':           ('SELECT DISTINCT COALESCE(m.mID, r.mID), m.title, m.director, m.year, m.length, r.aID, r.character FROM (SELECT * FROM Movies WHERE length > 140) m FULL JOIN Roles r ON m.mID = r.mID',
                            False, 'σ[length > 140](Movies) ⟗ Roles'),
  'x-three-way-left':      ('SELECT DISTINCT a.aID, a.aName, a.nationality, r.mID, r.character, m.title, m.director, m.year, m.length FROM Artists a LEFT JOIN Roles r ON a.aID = r.aID LEFT JOIN Movies m ON r.mID = m.mID',
                            True, 'Artists ⟕ Roles ⟕ Movies'),
  'x-theta-left':          ('SELECT DISTINCT * FROM Movies m LEFT JOIN Roles r ON m.mID = r.mID AND r.aID > 1',
                            False, 'Movies ⟕[Movies.mID = Roles.mID ∧ aID > 1] Roles'),
  'x-ascii':               ("SELECT DISTINCT title FROM Movies NATURAL JOIN Roles NATURAL JOIN Artists WHERE aName = 'Ford' OR year < 1975",
                            False, "project[title](select[aName = 'Ford' or year < 1975](Movies join Roles join Artists))"),
  # ¬ over a null is still unknown (three-valued logic), so Bachchan's padded row must not be kept
  'x-not-null-outer':      ("SELECT DISTINCT aID, aName, nationality, mID, character FROM Artists NATURAL LEFT JOIN Roles WHERE NOT (character = 'Han Solo')",
                            True, "σ[¬(character = 'Han Solo')](Artists ⟕ Roles)"),
}

# ---------- Imported CSV files ----------

FIXTURES = 'scripts/fixtures'
with open(f'{FIXTURES}/csv-cases.json', encoding='utf-8') as f:
    CSV = json.load(f)

NUMBER = re.compile(r'-?(0|[1-9][0-9]*)(\.[0-9]+)?')  # no leading zeros, so IDs like 007 stay text

def load_csv(path):
    """The import rules, written independently of the TypeScript importer."""
    with open(path, newline='', encoding='utf-8-sig') as f:
        rows = [[v.strip() for v in r] for r in csv.reader(f, skipinitialspace=True)]
    rows = [r for r in rows if any(r)]
    header = rows[0]
    while len(header) > 1 and header[-1] == '':
        header = header[:-1]
    body = []
    for r in rows[1:]:
        assert all(v == '' for v in r[len(header):]), (path, r)
        body.append([None if v == '' or v.lower() == 'null' else v for v in r[:len(header)]])
    for c in range(len(header)):
        vals = [r[c] for r in body if r[c] is not None]
        if vals and all(NUMBER.fullmatch(v) and len(v.replace('-', '').replace('.', '')) <= 15 for v in vals):
            for r in body:
                if r[c] is not None:
                    r[c] = float(r[c]) if '.' in r[c] else int(r[c])
    return header, body

def csv_db(files):
    c = sqlite3.connect(':memory:')
    q = lambda name: '"' + name.replace('"', '""') + '"'
    for name in files:
        header, body = load_csv(os.path.join(FIXTURES, name))
        table = name[:-4]
        c.execute(f'CREATE TABLE {q(table)} ({", ".join(q(h) for h in header)})')
        c.executemany(f'INSERT INTO {q(table)} VALUES ({", ".join("?" * len(header))})', body)
    return c

# ---------- Run everything through the engine and compare ----------

reqs = [{'id': k, **({'query': q} if q else {}), **({'bachchan': b} if b is not None else {})} for k, (_, b, q) in CASES.items()]
reqs += [{'id': c['id'], 'query': c['query'], 'csv': [os.path.join(FIXTURES, f) for f in CSV['sets'][c['set']]]} for c in CSV['cases']]
runner = ['bun'] if shutil.which('bun') else ['npx', 'tsx']
engine = json.loads(subprocess.run(runner + ['scripts/eval-queries.ts'], input=json.dumps(reqs),
                                   capture_output=True, text=True, check=True).stdout)

# 3 and 3.0 are the same value; normalise so the two sides sort identically.
same = lambda v: int(v) if isinstance(v, float) and v.is_integer() else v
norm = lambda rows: sorted((tuple(same(v) for v in r) for r in rows), key=repr)
csv_cases = {c['id']: c for c in CSV['cases']}
fails = 0
for res in engine:
    if res['id'] in csv_cases:
        case = csv_cases[res['id']]
        sql, conn = case['sql'], csv_db(CSV['sets'][case['set']])
    else:
        sql, conn = CASES[res['id']][0], db(res['bachchan'])
    if 'error' in res:
        fails += 1
        print(f"FAIL  {res['id']:<24} engine error: {res['error']}")
        continue
    expected = conn.execute(sql).fetchall()
    got = [tuple(r) for r in res['rows']]
    ok = norm(got) == norm(expected) and len(got) == len(set(got))
    fails += not ok
    print(f"{'PASS' if ok else 'FAIL'}  {res['id']:<24} {len(got):>2} rows  {res['query']}")
    if not ok:
        print('   engine:', norm(got)); print('   sqlite:', norm(expected))
print(f"\n{len(engine) - fails}/{len(engine)} queries match SQLite")
sys.exit(1 if fails else 0)
