import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const targetDbPath = path.resolve(projectRoot, 'src/data/ddinter_complete.db');
const tempDbPath = path.resolve(projectRoot, 'src/data/ddinter_complete.db.tmp');

console.log('=== Starting Clean SQLite Database Build for DDInter ===');

// Remove existing temp database if present
if (fs.existsSync(tempDbPath)) {
  fs.unlinkSync(tempDbPath);
}

const db = new DatabaseSync(tempDbPath);

// Fast build PRAGMAs
db.exec('PRAGMA synchronous = OFF;');
db.exec('PRAGMA journal_mode = MEMORY;');
db.exec('PRAGMA page_size = 4096;');

// Create tables
console.log('Creating tables...');
db.exec(`
CREATE TABLE drugs (
  ddinter_id TEXT PRIMARY KEY,
  name TEXT,
  drugbank_id TEXT,
  pubchem_id TEXT,
  chembl_id TEXT,
  smiles TEXT,
  drug_type TEXT DEFAULT 'small molecule',
  molecular_formula TEXT DEFAULT '',
  molecular_weight REAL DEFAULT 0,
  cas_number TEXT DEFAULT '',
  atc_code TEXT DEFAULT '',
  atc_category TEXT DEFAULT '',
  therapeutic_class TEXT DEFAULT '',
  brand_names TEXT DEFAULT '[]',
  structure_svg TEXT DEFAULT '',
  protein_sequence TEXT DEFAULT '',
  description TEXT DEFAULT '',
  mechanism TEXT DEFAULT '',
  targets TEXT DEFAULT '[]'
);

CREATE TABLE ddi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ddinter_id_a TEXT,
  drug_a TEXT,
  ddinter_id_b TEXT,
  drug_b TEXT,
  level TEXT
);

CREATE TABLE dfi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drug_name TEXT,
  ddinter_id TEXT,
  food_name TEXT,
  level TEXT,
  mechanism TEXT,
  management TEXT,
  references_text TEXT
);

CREATE TABLE ddsi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drug_name TEXT,
  ddinter_id TEXT,
  disease_name TEXT,
  level TEXT,
  text TEXT,
  references_text TEXT
);

CREATE TABLE dupli (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drug_multi_trade TEXT,
  drug_multi TEXT,
  drug_type TEXT,
  drug_b TEXT,
  ddinter_id_b TEXT,
  warning TEXT,
  note TEXT
);
`);

// 1. Insert Drugs
console.log('Inserting drugs from ddinter_all_drugs.json...');
const drugsJsonPath = path.resolve(projectRoot, 'src/data/ddinter_all_drugs.json');
const drugsRaw = JSON.parse(fs.readFileSync(drugsJsonPath, 'utf-8')) as any[];
const insertDrug = db.prepare(`
  INSERT INTO drugs (ddinter_id, name, drugbank_id, pubchem_id, chembl_id, smiles)
  VALUES (?, ?, ?, ?, ?, ?)
`);

db.exec('BEGIN TRANSACTION;');
for (const d of drugsRaw) {
  insertDrug.run(
    d.ddinterId || d.ddinter_id || '',
    d.name || '',
    d.drugbankId || d.drugbank_id || '',
    d.pubchemId || d.pubchem_id || '',
    d.chemblId || d.chembl_id || '',
    d.smiles || ''
  );
}
db.exec('COMMIT;');
console.log(`Inserted ${drugsRaw.length} drugs.`);

// 2. Insert DFI (Food Interactions)
console.log('Inserting food interactions from ddinter_all_foods.json...');
const foodsJsonPath = path.resolve(projectRoot, 'src/data/ddinter_all_foods.json');
const foodsRaw = JSON.parse(fs.readFileSync(foodsJsonPath, 'utf-8')) as any[];
const insertDfi = db.prepare(`
  INSERT INTO dfi (drug_name, ddinter_id, food_name, level, mechanism, management, references_text)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

db.exec('BEGIN TRANSACTION;');
for (const f of foodsRaw) {
  insertDfi.run(
    f.drugName || f.drug_name || '',
    f.internalID_a_id || f.ddinter_id || '',
    f.foodName || f.food_name || '',
    String(f.level || 'Moderate'),
    f.newInteraction || f.mechanism || '',
    f.newManagement || f.management || '',
    f.references || f.references_text || ''
  );
}
db.exec('COMMIT;');
console.log(`Inserted ${foodsRaw.length} food interactions.`);

// 3. Insert DDSI (Disease Interactions)
console.log('Inserting disease interactions from ddinter_all_ddsi.json...');
const ddsiJsonPath = path.resolve(projectRoot, 'src/data/ddinter_all_ddsi.json');
const ddsiRaw = JSON.parse(fs.readFileSync(ddsiJsonPath, 'utf-8')) as any[];
const insertDdsi = db.prepare(`
  INSERT INTO ddsi (drug_name, ddinter_id, disease_name, level, text, references_text)
  VALUES (?, ?, ?, ?, ?, ?)
`);

db.exec('BEGIN TRANSACTION;');
for (const d of ddsiRaw) {
  insertDdsi.run(
    d.drugName || d.drug_name || '',
    d.internalID_a_id || d.ddinter_id || '',
    d.diseaseName || d.disease_name || '',
    String(d.level || 'Major'),
    d.text || '',
    d.references || d.references_text || ''
  );
}
db.exec('COMMIT;');
console.log(`Inserted ${ddsiRaw.length} disease interactions.`);

// 4. Insert Dupli (Therapeutic Duplications)
console.log('Inserting duplications from ddinter_all_dupli.json...');
const dupliJsonPath = path.resolve(projectRoot, 'src/data/ddinter_all_dupli.json');
const dupliRaw = JSON.parse(fs.readFileSync(dupliJsonPath, 'utf-8')) as any[];
const insertDupli = db.prepare(`
  INSERT INTO dupli (drug_multi_trade, drug_multi, drug_type, drug_b, ddinter_id_b, warning, note)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

db.exec('BEGIN TRANSACTION;');
for (const dup of dupliRaw) {
  insertDupli.run(
    dup.drugmulti_trade || dup.drug_multi_trade || '',
    dup.drugmulti || dup.drug_multi || '',
    dup.drugtype || dup.drug_type || '',
    dup.drugb || dup.drug_b || '',
    dup.internalID_b_id || dup.ddinter_id_b || '',
    dup.warning || '',
    dup.note || ''
  );
}
db.exec('COMMIT;');
console.log(`Inserted ${dupliRaw.length} duplications.`);

// 5. Insert DDI from all CSVs
console.log('Inserting DDI records from CSV files in data_harvest/...');
const dataHarvestDir = path.resolve(projectRoot, 'data_harvest');
const csvFiles = fs.readdirSync(dataHarvestDir).filter((f) => f.endsWith('.csv')).sort();

const insertDdi = db.prepare(`
  INSERT INTO ddi (ddinter_id_a, drug_a, ddinter_id_b, drug_b, level)
  VALUES (?, ?, ?, ?, ?)
`);

const seenPairs = new Set<string>();
let totalDdiInserted = 0;

db.exec('BEGIN TRANSACTION;');
for (const csvFile of csvFiles) {
  const filePath = path.join(dataHarvestDir, csvFile);
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Fast CSV row split (DDInterID_A, Drug_A, DDInterID_B, Drug_B, Level)
    const parts = line.split(',');
    if (parts.length < 5) continue;

    const idA = parts[0].trim();
    const drugA = parts[1].trim();
    const idB = parts[2].trim();
    const drugB = parts[3].trim();
    const level = parts[4].trim();

    if (!idA || !idB) continue;

    // De-duplicate pair
    const pairKey = idA + '|' + idB;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);

    insertDdi.run(idA, drugA, idB, drugB, level);
    totalDdiInserted++;
  }
}
db.exec('COMMIT;');
console.log(`Inserted ${totalDdiInserted} unique DDI records from ${csvFiles.length} CSV files.`);

// 6. Create Indexes
console.log('Creating database indexes...');
db.exec(`
CREATE INDEX idx_drugs_name ON drugs(name COLLATE NOCASE);
CREATE INDEX idx_drugs_id ON drugs(ddinter_id);
CREATE INDEX idx_ddi_a ON ddi(ddinter_id_a);
CREATE INDEX idx_ddi_b ON ddi(ddinter_id_b);
CREATE INDEX idx_ddi_drug_a ON ddi(drug_a COLLATE NOCASE);
CREATE INDEX idx_ddi_drug_b ON ddi(drug_b COLLATE NOCASE);
CREATE INDEX idx_ddi_level ON ddi(level);
CREATE INDEX idx_dfi_drug ON dfi(drug_name COLLATE NOCASE);
CREATE INDEX idx_dfi_ddinter ON dfi(ddinter_id);
CREATE INDEX idx_dfi_food ON dfi(food_name COLLATE NOCASE);
CREATE INDEX idx_ddsi_drug ON ddsi(drug_name COLLATE NOCASE);
CREATE INDEX idx_ddsi_ddinter ON ddsi(ddinter_id);
CREATE INDEX idx_ddsi_disease ON ddsi(disease_name COLLATE NOCASE);
CREATE INDEX idx_dupli_type ON dupli(drug_type COLLATE NOCASE);
CREATE INDEX idx_dupli_drugb ON dupli(drug_b COLLATE NOCASE);
`);

// 7. Verify Integrity
console.log('Verifying integrity with PRAGMA integrity_check...');
const check = (db.prepare('PRAGMA integrity_check;').get() as any)?.integrity_check;
console.log('Integrity check result:', check);
if (check !== 'ok') {
  throw new Error(`Integrity check failed: ${check}`);
}

// Close connection before replacing file
db.close();

// Atomically replace target database
if (fs.existsSync(targetDbPath)) {
  fs.unlinkSync(targetDbPath);
}
fs.renameSync(tempDbPath, targetDbPath);
const finalSizeMb = (fs.statSync(targetDbPath).size / (1024 * 1024)).toFixed(2);
console.log(`Successfully built clean DDInter SQLite database (${finalSizeMb} MB)!`);
