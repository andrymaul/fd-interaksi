import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolvePharmacotherapyClass } from '../src/data/atcClassifier.ts';

const DB_PATH = path.join(process.cwd(), 'src/data/ddinter_complete.db');
const db = new DatabaseSync(DB_PATH);

console.log('--- Starting Pharmacotherapy Class Update ---');

// 1. Load curated ATC codes if available
const curatedPath = path.join(process.cwd(), 'src/data/curated_ddinter_details.json');
let curatedDrugs: Record<string, any> = {};
if (fs.existsSync(curatedPath)) {
  try {
    curatedDrugs = JSON.parse(fs.readFileSync(curatedPath, 'utf-8'));
    console.log(`[Update] Loaded ${Object.keys(curatedDrugs).length} curated reference records.`);
  } catch (e) {
    console.warn('[Update] Error reading curated file:', e);
  }
}

// 2. Fetch all drugs
const drugs = db.prepare('SELECT ddinter_id, name, drug_type, atc_code, atc_category, mechanism, therapeutic_class FROM drugs').all() as any[];
console.log(`[Update] Processing ${drugs.length} drug records in SQLite...`);

const updateStmt = db.prepare(`
  UPDATE drugs 
  SET atc_code = ?,
      atc_category = ?,
      therapeutic_class = ?
  WHERE ddinter_id = ?
`);

let updatedCount = 0;
let specificClassCount = 0;

for (const drug of drugs) {
  let atc = drug.atc_code || '';
  const curated = curatedDrugs[drug.ddinter_id.toUpperCase()] || curatedDrugs[drug.ddinter_id];
  
  if (!atc && curated && curated.atcClassification && curated.atcClassification.length > 0) {
    atc = curated.atcClassification.join(', ');
  }

  const resolved = resolvePharmacotherapyClass(atc, drug.name, drug.drug_type, drug.mechanism);

  if (resolved.therapeuticClass !== 'Senyawa Farmakoterapi Terdaftar DDInter v2.0') {
    specificClassCount++;
  }

  updateStmt.run(atc, resolved.atcCategory, resolved.therapeuticClass, drug.ddinter_id);
  updatedCount++;
}

console.log(`[Update] Successfully updated ${updatedCount} drugs.`);
console.log(`[Update] High-specificity pharmacotherapeutic classes mapped: ${specificClassCount} drugs.`);

// Check Acamprosate (DDInter10) specifically
const acamprosate = db.prepare('SELECT ddinter_id, name, atc_code, atc_category, therapeutic_class FROM drugs WHERE ddinter_id = ?').get('DDInter10') as any;
console.log('[Verification] Acamprosate in SQLite:', acamprosate);

console.log('--- Finished Pharmacotherapy Class Update Successfully ---');
