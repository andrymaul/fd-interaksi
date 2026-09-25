import urllib.request
import urllib.parse
import json
import re
import time
import sqlite3
import glob
import csv
import os

print("=== Starting DDInter Clean Database Builder ===")

def get_session():
    for attempt in range(5):
        try:
            req = urllib.request.Request('https://ddinter2.scbdd.com/server/other_interaction/', headers={'User-Agent': 'Mozilla/5.0'})
            resp = urllib.request.urlopen(req, timeout=15)
            html = resp.read().decode('utf-8')
            cookie = resp.headers.get('Set-Cookie', '')
            csrf = re.search(r'csrfmiddlewaretoken:\s*\'([^\']+)\'', html).group(1)
            return cookie, csrf
        except Exception as e:
            print(f"Session connect error (attempt {attempt+1}): {e}")
            time.sleep(2)
    raise RuntimeError("Failed to obtain DDInter session")

def fetch_table(endpoint, referer, start=0, length=1000, cookie=None, csrf=None):
    data = urllib.parse.urlencode({
        'csrfmiddlewaretoken': csrf,
        'draw': '1',
        'start': str(start),
        'length': str(length)
    }).encode('utf-8')
    req = urllib.request.Request(f'https://ddinter2.scbdd.com/server/{endpoint}/', data=data, headers={
        'User-Agent': 'Mozilla/5.0',
        'Cookie': cookie,
        'Referer': f'https://ddinter2.scbdd.com/server/{referer}/',
        'X-Requested-With': 'XMLHttpRequest'
    })
    resp = urllib.request.urlopen(req, timeout=30)
    return json.loads(resp.read().decode('utf-8'))

# 1. Check or fetch Disease records (8,359 items)
all_diseases = []
ddsi_json_path = 'src/data/ddinter_all_ddsi.json'
if os.path.exists(ddsi_json_path) and os.path.getsize(ddsi_json_path) > 100000:
    print(f"Loading existing {ddsi_json_path}...")
    with open(ddsi_json_path, 'r', encoding='utf-8') as f:
        all_diseases = json.load(f)
    print(f"Loaded {len(all_diseases)} disease records from JSON cache.")
else:
    print("Fetching disease contraindications from DDInter portal...")
    cookie, csrf = get_session()
    start = 0
    batch_size = 1000
    while True:
        print(f"Fetching diseases from offset {start}...")
        try:
            res = fetch_table('disease-interaction-source', 'other_interaction', start=start, length=batch_size, cookie=cookie, csrf=csrf)
            items = res.get('data', [])
            if not items:
                break
            all_diseases.extend(items)
            print(f"Fetched {len(items)} items (total: {len(all_diseases)} / {res.get('recordsTotal', 8359)})")
            start += batch_size
            if start >= res.get('recordsTotal', 8359):
                break
            time.sleep(0.3)
        except Exception as e:
            print(f"Retry fetching diseases offset {start}: {e}")
            time.sleep(2)
            cookie, csrf = get_session()
    with open(ddsi_json_path, 'w', encoding='utf-8') as f:
        json.dump(all_diseases, f, indent=2)
    print(f"Saved {len(all_diseases)} disease records to {ddsi_json_path}.")

# Also ensure ddinter_all_diseases.json is updated
unique_diseases = {}
for d in all_diseases:
    dname = (d.get('diseaseName') or '').strip()
    if not dname:
        continue
    if dname not in unique_diseases:
        unique_diseases[dname] = {
            'name': dname,
            'contraindicatedDrugsCount': 0,
            'sampleWarning': (d.get('text') or '')[:200]
        }
    unique_diseases[dname]['contraindicatedDrugsCount'] += 1

disease_summary_list = sorted(list(unique_diseases.values()), key=lambda x: -x['contraindicatedDrugsCount'])
with open('src/data/ddinter_all_diseases.json', 'w', encoding='utf-8') as f:
    json.dump(disease_summary_list, f, indent=2)

# 2. Check or fetch Duplication records (6,033 items)
all_dupli = []
dupli_json_path = 'src/data/ddinter_all_dupli.json'
if os.path.exists(dupli_json_path) and os.path.getsize(dupli_json_path) > 100000:
    print(f"Loading existing {dupli_json_path}...")
    with open(dupli_json_path, 'r', encoding='utf-8') as f:
        all_dupli = json.load(f)
    print(f"Loaded {len(all_dupli)} duplication records from JSON cache.")
else:
    print("Fetching therapeutic duplications from DDInter portal...")
    cookie, csrf = get_session()
    start = 0
    batch_size = 1000
    while True:
        print(f"Fetching duplications from offset {start}...")
        try:
            res = fetch_table('dupli-interaction-source', 'other_interaction', start=start, length=batch_size, cookie=cookie, csrf=csrf)
            items = res.get('data', [])
            if not items:
                break
            all_dupli.extend(items)
            print(f"Fetched {len(items)} items (total: {len(all_dupli)} / {res.get('recordsTotal', 6033)})")
            start += batch_size
            if start >= res.get('recordsTotal', 6033):
                break
            time.sleep(0.3)
        except Exception as e:
            print(f"Retry fetching duplications offset {start}: {e}")
            time.sleep(2)
            cookie, csrf = get_session()
    with open(dupli_json_path, 'w', encoding='utf-8') as f:
        json.dump(all_dupli, f, indent=2)
    print(f"Saved {len(all_dupli)} duplication records to {dupli_json_path}.")

# 3. Create fresh clean SQLite database
tmp_db_path = 'src/data/ddinter_complete.db.tmp'
if os.path.exists(tmp_db_path):
    os.remove(tmp_db_path)

conn = sqlite3.connect(tmp_db_path)
cur = conn.cursor()

# Optimize SQLite settings for building database
cur.execute('PRAGMA synchronous = OFF;')
cur.execute('PRAGMA journal_mode = MEMORY;')
cur.execute('PRAGMA page_size = 4096;')

cur.execute('''
CREATE TABLE drugs (
    ddinter_id TEXT PRIMARY KEY,
    name TEXT,
    drugbank_id TEXT,
    pubchem_id TEXT,
    chembl_id TEXT,
    smiles TEXT
)
''')

cur.execute('''
CREATE TABLE ddi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ddinter_id_a TEXT,
    drug_a TEXT,
    ddinter_id_b TEXT,
    drug_b TEXT,
    level TEXT
)
''')

cur.execute('''
CREATE TABLE dfi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drug_name TEXT,
    ddinter_id TEXT,
    food_name TEXT,
    level TEXT,
    mechanism TEXT,
    management TEXT,
    references_text TEXT
)
''')

cur.execute('''
CREATE TABLE ddsi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drug_name TEXT,
    ddinter_id TEXT,
    disease_name TEXT,
    level TEXT,
    text TEXT,
    references_text TEXT
)
''')

cur.execute('''
CREATE TABLE dupli (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    drug_multi_trade TEXT,
    drug_multi TEXT,
    drug_type TEXT,
    drug_b TEXT,
    ddinter_id_b TEXT,
    warning TEXT,
    note TEXT
)
''')

# Populate drugs
print("Inserting drugs...")
with open('src/data/ddinter_all_drugs.json', 'r', encoding='utf-8') as f:
    drugs_list = json.load(f)

drug_rows = []
for d in drugs_list:
    drug_rows.append((
        d.get('ddinterId', ''),
        d.get('name', ''),
        d.get('drugbankId', ''),
        d.get('pubchemId', ''),
        d.get('chemblId', ''),
        d.get('smiles', '')
    ))
cur.executemany('INSERT INTO drugs VALUES (?, ?, ?, ?, ?, ?)', drug_rows)
print(f"Inserted {len(drug_rows)} drugs.")

# Populate dfi
print("Inserting food interactions...")
with open('src/data/ddinter_all_foods.json', 'r', encoding='utf-8') as f:
    foods_list = json.load(f)

dfi_rows = []
for f_item in foods_list:
    dfi_rows.append((
        f_item.get('drugName', ''),
        f_item.get('internalID_a_id', ''),
        f_item.get('foodName', ''),
        str(f_item.get('level', '')),
        f_item.get('newInteraction', ''),
        f_item.get('newManagement', ''),
        f_item.get('references', '')
    ))
cur.executemany('''
INSERT INTO dfi (drug_name, ddinter_id, food_name, level, mechanism, management, references_text)
VALUES (?, ?, ?, ?, ?, ?, ?)
''', dfi_rows)
print(f"Inserted {len(dfi_rows)} food interactions.")

# Populate ddsi
print("Inserting disease interactions...")
ddsi_rows = []
for d_item in all_diseases:
    ddsi_rows.append((
        d_item.get('drugName', ''),
        d_item.get('internalID_a_id', ''),
        d_item.get('diseaseName', ''),
        str(d_item.get('level', '')),
        d_item.get('text', ''),
        d_item.get('references', '')
    ))
cur.executemany('''
INSERT INTO ddsi (drug_name, ddinter_id, disease_name, level, text, references_text)
VALUES (?, ?, ?, ?, ?, ?)
''', ddsi_rows)
print(f"Inserted {len(ddsi_rows)} disease interactions.")

# Populate dupli
print("Inserting duplication interactions...")
dupli_rows = []
for dup in all_dupli:
    dupli_rows.append((
        dup.get('drugmulti_trade', ''),
        dup.get('drugmulti', ''),
        dup.get('drugtype', ''),
        dup.get('drugb', ''),
        dup.get('internalID_b_id', ''),
        dup.get('warning', ''),
        dup.get('note', '')
    ))
cur.executemany('''
INSERT INTO dupli (drug_multi_trade, drug_multi, drug_type, drug_b, ddinter_id_b, warning, note)
VALUES (?, ?, ?, ?, ?, ?, ?)
''', dupli_rows)
print(f"Inserted {len(dupli_rows)} duplications.")

# Populate ddi from CSVs
print("Inserting DDI records from CSV files...")
csv_files = sorted(glob.glob('data_harvest/ddinter_downloads_code_*.csv'))
total_ddi = 0
for csv_file in csv_files:
    print(f"Processing {csv_file}...")
    batch = []
    with open(csv_file, 'r', encoding='utf-8', errors='ignore') as f:
        reader = csv.DictReader(f)
        for row in reader:
            batch.append((
                row.get('DDInterID_A', '').strip(),
                row.get('Drug_A', '').strip(),
                row.get('DDInterID_B', '').strip(),
                row.get('Drug_B', '').strip(),
                row.get('Level', '').strip()
            ))
            if len(batch) >= 20000:
                cur.executemany('''
                INSERT INTO ddi (ddinter_id_a, drug_a, ddinter_id_b, drug_b, level)
                VALUES (?, ?, ?, ?, ?)
                ''', batch)
                total_ddi += len(batch)
                batch = []
    if batch:
        cur.executemany('''
        INSERT INTO ddi (ddinter_id_a, drug_a, ddinter_id_b, drug_b, level)
        VALUES (?, ?, ?, ?, ?)
        ''', batch)
        total_ddi += len(batch)

print(f"Inserted {total_ddi} DDI records.")

# Create indexes
print("Creating indexes...")
cur.execute('CREATE INDEX idx_drugs_name ON drugs(name COLLATE NOCASE)')
cur.execute('CREATE INDEX idx_drugs_id ON drugs(ddinter_id)')
cur.execute('CREATE INDEX idx_ddi_a ON ddi(ddinter_id_a)')
cur.execute('CREATE INDEX idx_ddi_b ON ddi(ddinter_id_b)')
cur.execute('CREATE INDEX idx_ddi_drug_a ON ddi(drug_a COLLATE NOCASE)')
cur.execute('CREATE INDEX idx_ddi_drug_b ON ddi(drug_b COLLATE NOCASE)')
cur.execute('CREATE INDEX idx_ddi_level ON ddi(level)')
cur.execute('CREATE INDEX idx_dfi_drug ON dfi(drug_name COLLATE NOCASE)')
cur.execute('CREATE INDEX idx_dfi_food ON dfi(food_name COLLATE NOCASE)')
cur.execute('CREATE INDEX idx_ddsi_drug ON ddsi(drug_name COLLATE NOCASE)')
cur.execute('CREATE INDEX idx_ddsi_disease ON ddsi(disease_name COLLATE NOCASE)')
cur.execute('CREATE INDEX idx_dupli_type ON dupli(drug_type COLLATE NOCASE)')
cur.execute('CREATE INDEX idx_dupli_drugb ON dupli(drug_b COLLATE NOCASE)')

conn.commit()

# Verify integrity
print("Running PRAGMA integrity_check...")
check = cur.execute('PRAGMA integrity_check;').fetchall()
print("Integrity check result:", check)
if check != [('ok',)]:
    raise RuntimeError(f"Integrity check failed: {check}")

# Switch back to journal mode DELETE for safe storage
cur.execute('PRAGMA journal_mode = DELETE;')
conn.close()

# Replace corrupted database
final_db_path = 'src/data/ddinter_complete.db'
if os.path.exists(final_db_path):
    os.remove(final_db_path)
os.rename(tmp_db_path, final_db_path)
print(f"Successfully created and installed {final_db_path} ({os.path.getsize(final_db_path)} bytes)!")

# Update ddinter_stats.json
stats = {
    "totalApprovedDrugs": len(drug_rows),
    "totalDistinctDrugs": len(drug_rows),
    "totalDDIRecords": total_ddi,
    "distinctDdiMechanisms": 8398,
    "totalDFIRecords": len(dfi_rows),
    "dfiFoodsCount": 29,
    "dfiMechanismsCount": 430,
    "totalDDSIRecords": len(ddsi_rows),
    "totalUniqueDiseases": len(disease_summary_list),
    "ddsiDetailedInfoCount": 3300,
    "totalDuplicationRecords": len(dupli_rows),
    "duplicationCombinationDrugs": 317,
    "duplicationPharmClasses": 96,
    "totalLiteraturePieces": 16028,
    "literatureDdi": 12298,
    "literatureDfi": 430,
    "literatureDdsi": 3300,
    "databaseFile": "src/data/ddinter_complete.db",
    "databaseSizeBytes": os.path.getsize(final_db_path),
    "portalUrl": "https://ddinter2.scbdd.com/",
    "citation": "DDInter 2.0: an enhanced drug interaction resource with expanded data coverage, new interaction types, and improved user interface (Nucleic Acids Research, 2024)",
    "generatedAt": time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())
}

with open('src/data/ddinter_stats.json', 'w', encoding='utf-8') as f:
    json.dump(stats, f, indent=2)

print("Updated stats.json:")
print(json.dumps(stats, indent=2))
print("=== DATABASE REBUILD COMPLETE & VERIFIED! ===")
