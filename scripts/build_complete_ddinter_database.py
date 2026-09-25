import sqlite3
import json
import glob
import csv
import os
import time

print("=== Building Complete DDInter 2.0 SQLite Database ===")

db_path = 'src/data/ddinter_complete.db'
if os.path.exists(db_path):
    os.remove(db_path)

conn = sqlite3.connect(db_path)
cur = conn.cursor()

# 1. Create Tables
print("Creating schema...")
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

cur.execute('''
CREATE TABLE ddi_mechanisms (
    id INTEGER PRIMARY KEY,
    level INTEGER,
    interaction TEXT,
    antagonistic_effect INTEGER,
    synergistic_effect INTEGER,
    absorption INTEGER,
    distribution INTEGER,
    metabolism INTEGER,
    excretion INTEGER,
    others INTEGER
)
''')

# 2. Insert Drugs (2,290 entries from ddinter_all_drugs.json)
print("\n--- 1. Inserting Drugs ---")
with open('src/data/ddinter_all_drugs.json', 'r', encoding='utf-8') as f:
    drugs_data = json.load(f)

drug_rows = []
for d in drugs_data:
    drug_rows.append((
        d.get('ddinterId', ''),
        d.get('name', ''),
        d.get('drugbankId', ''),
        d.get('pubchemId', ''),
        d.get('chemblId', ''),
        d.get('smiles', '')
    ))

cur.executemany('INSERT INTO drugs VALUES (?, ?, ?, ?, ?, ?)', drug_rows)
print(f"Inserted {len(drug_rows)} drugs into SQLite.")

# 3. Insert DDI from ALL 13 CSVs (475,225 rows covering all 302,665 DDInter associations)
print("\n--- 2. Inserting All DDI Records from 13 CSVs ---")
csv_files = sorted(glob.glob('data_harvest/ddinter_downloads_code_*.csv'))
print(f"Found {len(csv_files)} CSV files: {[os.path.basename(c) for c in csv_files]}")

total_ddi = 0
batch = []
for csv_file in csv_files:
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
            if len(batch) >= 10000:
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

print(f"Inserted {total_ddi} DDI records into SQLite.")

# 4. Insert DFI (857 entries)
print("\n--- 3. Inserting Drug-Food Interactions (857) ---")
with open('src/data/ddinter_all_foods.json', 'r', encoding='utf-8') as f:
    foods_data = json.load(f)

dfi_rows = []
for f_item in foods_data:
    dfi_rows.append((
        f_item.get('drugName'),
        f_item.get('internalID_a_id'),
        f_item.get('foodName'),
        f_item.get('level'),
        f_item.get('newInteraction'),
        f_item.get('newManagement'),
        f_item.get('references')
    ))

cur.executemany('''
INSERT INTO dfi (drug_name, ddinter_id, food_name, level, mechanism, management, references_text)
VALUES (?, ?, ?, ?, ?, ?, ?)
''', dfi_rows)
print(f"Inserted {len(dfi_rows)} DFI records into SQLite.")

# 5. Insert DDSI (8,359 entries)
print("\n--- 4. Inserting Drug-Disease Contraindications (8,359) ---")
with open('src/data/ddinter_all_ddsi.json', 'r', encoding='utf-8') as f:
    ddsi_data = json.load(f)

ddsi_rows = []
for d_item in ddsi_data:
    ddsi_rows.append((
        d_item.get('drugName'),
        d_item.get('internalID_a_id'),
        d_item.get('diseaseName'),
        d_item.get('level'),
        d_item.get('text'),
        d_item.get('references')
    ))

cur.executemany('''
INSERT INTO ddsi (drug_name, ddinter_id, disease_name, level, text, references_text)
VALUES (?, ?, ?, ?, ?, ?)
''', ddsi_rows)
print(f"Inserted {len(ddsi_rows)} DDSI records into SQLite.")

# 6. Insert Duplications (6,033 entries)
print("\n--- 5. Inserting Therapeutic Duplications (6,033) ---")
with open('src/data/ddinter_all_dupli.json', 'r', encoding='utf-8') as f:
    dupli_data = json.load(f)

dupli_rows = []
for dup in dupli_data:
    dupli_rows.append((
        dup.get('drugmulti_trade'),
        dup.get('drugmulti'),
        dup.get('drugtype'),
        dup.get('drugb'),
        dup.get('internalID_b_id'),
        dup.get('warning'),
        dup.get('note')
    ))

cur.executemany('''
INSERT INTO dupli (drug_multi_trade, drug_multi, drug_type, drug_b, ddinter_id_b, warning, note)
VALUES (?, ?, ?, ?, ?, ?, ?)
''', dupli_rows)
print(f"Inserted {len(dupli_rows)} Duplication records into SQLite.")

# 7. Insert Mechanisms (8,466 entries)
print("\n--- 6. Inserting Mechanism Descriptions (8,466) ---")
with open('src/data/ddinter_all_mechanisms.json', 'r', encoding='utf-8') as f:
    mechs_data = json.load(f)

mech_rows = []
for m in mechs_data:
    mech_rows.append((
        int(m.get('id', 0)),
        int(m.get('level', 0)),
        m.get('interaction', ''),
        int(m.get('antagonistic_effect', 0) or 0),
        int(m.get('synergistic_effect', 0) or 0),
        int(m.get('absorption', 0) or 0),
        int(m.get('distribution', 0) or 0),
        int(m.get('metabolism', 0) or 0),
        int(m.get('excretion', 0) or 0),
        int(m.get('others', 0) or 0)
    ))

cur.executemany('''
INSERT INTO ddi_mechanisms VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
''', mech_rows)
print(f"Inserted {len(mech_rows)} Mechanism records into SQLite.")

# 8. Create Indexes
print("\n--- 7. Creating Indexes ---")
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
cur.execute('CREATE INDEX idx_mechs_level ON ddi_mechanisms(level)')

conn.commit()
conn.close()

db_size = os.path.getsize(db_path)
print(f"\nDatabase built successfully! Size: {db_size / (1024*1024):.2f} MB")

# 9. Update ddinter_stats.json with full official verified numbers
stats = {
    'totalApprovedDrugs': 2310,
    'totalDistinctDrugs': 2122,
    'totalDDIRecords': 302665,
    'distinctDdiMechanisms': 8398,
    'totalDFIRecords': 857,
    'dfiFoodsCount': 29,
    'dfiMechanismsCount': 430,
    'totalDDSIRecords': 8359,
    'totalUniqueDiseases': 472,
    'ddsiDetailedInfoCount': 3300,
    'totalDuplicationRecords': 6033,
    'duplicationCombinationDrugs': 317,
    'duplicationPharmClasses': 96,
    'totalLiteraturePieces': 16028,
    'literatureDdi': 12298,
    'literatureDfi': 430,
    'literatureDdsi': 3300,
    'rawDdiAssociationsCount': total_ddi,
    'mechanismsHarvested': len(mech_rows),
    'databaseFile': 'src/data/ddinter_complete.db',
    'databaseSizeBytes': db_size,
    'portalUrl': 'https://ddinter2.scbdd.com/',
    'citation': 'DDInter 2.0: an enhanced drug interaction resource with expanded data coverage, new interaction types, and improved user interface (Nucleic Acids Research, 2024)',
    'generatedAt': time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())
}

with open('src/data/ddinter_stats.json', 'w') as f:
    json.dump(stats, f, indent=2)

print("\nOfficial DDInter 2.0 Statistics JSON saved:")
print(json.dumps(stats, indent=2))
