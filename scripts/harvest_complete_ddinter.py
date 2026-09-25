import urllib.request
import urllib.parse
import json
import re
import time
import sqlite3
import glob
import csv
import os

print("=== Starting Complete DDInter v2.0 Harvester ===")

# 1. Establish session & CSRF
def get_session():
    req = urllib.request.Request('https://ddinter2.scbdd.com/server/other_interaction/', headers={'User-Agent': 'Mozilla/5.0'})
    resp = urllib.request.urlopen(req, timeout=15)
    html = resp.read().decode('utf-8')
    cookie = resp.headers.get('Set-Cookie', '')
    csrf = re.search(r'csrfmiddlewaretoken:\s*\'([^\']+)\'', html).group(1)
    return cookie, csrf

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
    resp = urllib.request.urlopen(req, timeout=45)
    return json.loads(resp.read().decode('utf-8'))

cookie, csrf = get_session()
print("Session established.")

os.makedirs('src/data', exist_ok=True)
db_path = 'src/data/ddinter_complete.db'
if os.path.exists(db_path):
    os.remove(db_path)

conn = sqlite3.connect(db_path)
cur = conn.cursor()

# Create Tables
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

# 1. Harvest Drugs (2,290 entries)
print("\n--- 1. Harvesting All Approved Drugs (target ~2,290) ---")
all_drugs = []
start = 0
batch_size = 250
while True:
    print(f"Fetching drugs from offset {start}...")
    try:
        res = fetch_table('drug-source', 'drug', start=start, length=batch_size, cookie=cookie, csrf=csrf)
        items = res.get('data', [])
        if not items:
            break
        all_drugs.extend(items)
        print(f"Fetched {len(items)} drugs (total so far: {len(all_drugs)}/{res.get('recordsTotal', 2290)})")
        start += batch_size
        if start >= res.get('recordsTotal', 2290):
            break
        time.sleep(0.3)
    except Exception as e:
        print(f"Retry fetching drugs offset {start}: {e}")
        time.sleep(1)
        cookie, csrf = get_session()

# Insert drugs into DB and clean JSON
drugs_for_json = []
for d in all_drugs:
    ddinter_id = d.get('internalID') or ''
    name = d.get('name') or ''
    drugbank = d.get('drugbank') or ''
    pubchem = d.get('pubchem') or ''
    chembl = d.get('chembl') or ''
    smiles = d.get('smiles') or ''
    
    cur.execute('INSERT OR REPLACE INTO drugs VALUES (?, ?, ?, ?, ?, ?)',
                (ddinter_id, name, drugbank, pubchem, chembl, smiles))
    drugs_for_json.append({
        'id': name.lower().replace(' ', '-').replace('/', '-'),
        'ddinterId': ddinter_id,
        'name': name,
        'drugbankId': drugbank,
        'pubchemId': pubchem,
        'chemblId': chembl,
        'smiles': smiles
    })

print(f"Stored {len(drugs_for_json)} drugs in database.")
with open('src/data/ddinter_all_drugs.json', 'w', encoding='utf-8') as f:
    json.dump(drugs_for_json, f, indent=2)

# 2. Harvest Food Interactions (857 entries)
print("\n--- 2. Harvesting All Drug-Food Interactions (target: 857) ---")
all_foods = []
res_food = fetch_table('food-interaction-source', 'other_interaction', start=0, length=1000, cookie=cookie, csrf=csrf)
for f_item in res_food.get('data', []):
    all_foods.append(f_item)
    cur.execute('''
    INSERT INTO dfi (drug_name, ddinter_id, food_name, level, mechanism, management, references_text)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (
        f_item.get('drugName'),
        f_item.get('internalID_a_id'),
        f_item.get('foodName'),
        f_item.get('level'),
        f_item.get('newInteraction'),
        f_item.get('newManagement'),
        f_item.get('references')
    ))
print(f"Stored {len(all_foods)} food interactions in database.")
with open('src/data/ddinter_all_foods.json', 'w', encoding='utf-8') as f:
    json.dump(all_foods, f, indent=2)

# 3. Harvest Disease Contraindications (8,359 entries)
print("\n--- 3. Harvesting All Drug-Disease Interactions (target: ~8,359) ---")
all_diseases = []
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
        for d_item in items:
            cur.execute('''
            INSERT INTO ddsi (drug_name, ddinter_id, disease_name, level, text, references_text)
            VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                d_item.get('drugName'),
                d_item.get('internalID_a_id'),
                d_item.get('diseaseName'),
                d_item.get('level'),
                d_item.get('text'),
                d_item.get('references')
            ))
        print(f"Fetched {len(items)} disease records (total so far: {len(all_diseases)}/{res.get('recordsTotal', 8359)})")
        start += batch_size
        if start >= res.get('recordsTotal', 8359):
            break
        time.sleep(0.3)
    except Exception as e:
        print(f"Retry fetching disease offset {start}: {e}")
        time.sleep(1)
        cookie, csrf = get_session()

print(f"Stored {len(all_diseases)} disease contraindications in database.")

# Extract unique diseases summary
unique_diseases = {}
for d in all_diseases:
    dname = d.get('diseaseName', '').strip()
    if dname and dname not in unique_diseases:
        unique_diseases[dname] = {
            'name': dname,
            'contraindicatedDrugsCount': 0,
            'sampleWarning': d.get('text', '')[:200]
        }
    if dname:
        unique_diseases[dname]['contraindicatedDrugsCount'] += 1

disease_summary_list = sorted(list(unique_diseases.values()), key=lambda x: -x['contraindicatedDrugsCount'])
with open('src/data/ddinter_all_diseases.json', 'w', encoding='utf-8') as f:
    json.dump(disease_summary_list, f, indent=2)

# 4. Harvest Therapeutic Duplications (6,033 entries)
print("\n--- 4. Harvesting All Therapeutic Duplications (target: ~6,033) ---")
all_dupli = []
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
        for dup in items:
            cur.execute('''
            INSERT INTO dupli (drug_multi_trade, drug_multi, drug_type, drug_b, ddinter_id_b, warning, note)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                dup.get('drugmulti_trade'),
                dup.get('drugmulti'),
                dup.get('drugtype'),
                dup.get('drugb'),
                dup.get('internalID_b_id'),
                dup.get('warning'),
                dup.get('note')
            ))
        print(f"Fetched {len(items)} duplication records (total so far: {len(all_dupli)}/{res.get('recordsTotal', 6033)})")
        start += batch_size
        if start >= res.get('recordsTotal', 6033):
            break
        time.sleep(0.3)
    except Exception as e:
        print(f"Retry fetching dupli offset {start}: {e}")
        time.sleep(1)
        cookie, csrf = get_session()

print(f"Stored {len(all_dupli)} therapeutic duplications in database.")

# 5. Load all DDI records from the 8 official CSVs (222,383 records)
print("\n--- 5. Loading All DDI CSV Records into SQLite ---")
csv_files = glob.glob('data_harvest/ddinter_downloads_code_*.csv')
print(f"Processing {len(csv_files)} CSV files...")

ddi_batch = []
total_ddi = 0
for csv_file in csv_files:
    with open(csv_file, 'r', encoding='utf-8', errors='ignore') as f:
        reader = csv.DictReader(f)
        for row in reader:
            ddi_batch.append((
                row.get('DDInterID_A', '').strip(),
                row.get('Drug_A', '').strip(),
                row.get('DDInterID_B', '').strip(),
                row.get('Drug_B', '').strip(),
                row.get('Level', '').strip()
            ))
            if len(ddi_batch) >= 10000:
                cur.executemany('''
                INSERT INTO ddi (ddinter_id_a, drug_a, ddinter_id_b, drug_b, level)
                VALUES (?, ?, ?, ?, ?)
                ''', ddi_batch)
                total_ddi += len(ddi_batch)
                ddi_batch = []

if ddi_batch:
    cur.executemany('''
    INSERT INTO ddi (ddinter_id_a, drug_a, ddinter_id_b, drug_b, level)
    VALUES (?, ?, ?, ?, ?)
    ''', ddi_batch)
    total_ddi += len(ddi_batch)

print(f"Inserted {total_ddi} DDI records into SQLite!")

# Create Indexes for lightning-fast queries
print("\n--- 6. Creating Database Indexes ---")
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
conn.close()

# Save final statistics JSON
stats = {
    'totalApprovedDrugs': len(all_drugs),
    'totalDDIRecords': total_ddi,
    'totalDFIRecords': len(all_foods),
    'totalDDSIRecords': len(all_diseases),
    'totalUniqueDiseases': len(disease_summary_list),
    'totalDuplicationRecords': len(all_dupli),
    'databaseFile': 'src/data/ddinter_complete.db',
    'databaseSizeBytes': os.path.getsize(db_path),
    'generatedAt': time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())
}

with open('src/data/ddinter_stats.json', 'w') as f:
    json.dump(stats, f, indent=2)

print("\n=== COMPLETE HARVEST FINISHED SUCCESSFULLY! ===")
print(json.dumps(stats, indent=2))
