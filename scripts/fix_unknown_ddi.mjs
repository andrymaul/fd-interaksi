import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

const dbPath = path.resolve('./src/data/ddinter_complete.db');
console.log('Connecting to', dbPath);
const db = new DatabaseSync(dbPath);

// 1. Create index on (ddinter_id_a, ddinter_id_b) and (drug_a, drug_b) if not exists
console.log('Ensuring indexes exist...');
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_ddi_pair_ids ON ddi (ddinter_id_a, ddinter_id_b);
  CREATE INDEX IF NOT EXISTS idx_ddi_pair_drugs ON ddi (drug_a, drug_b);
`);

// 2. Read all CSV files and collect all pairs that have 'Unknown' level
console.log('Scanning CSVs in ./data_harvest for Unknown pairs...');
const harvestDir = path.resolve('./data_harvest');
const files = fs.readdirSync(harvestDir).filter(f => f.endsWith('.csv'));

const unknownPairs = [];
for (const file of files) {
  const content = fs.readFileSync(path.join(harvestDir, file), 'utf-8');
  const lines = content.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(',');
    if (parts.length >= 5) {
      const idA = parts[0].trim();
      const idB = parts[2].trim();
      const level = parts[4].trim();
      if (level.toLowerCase() === 'unknown' && idA.startsWith('DDInter') && idB.startsWith('DDInter')) {
        unknownPairs.push([idA, idB]);
      }
    }
  }
}

console.log(`Found ${unknownPairs.length} pairs with 'Unknown' in CSVs.`);

// 3. Update level in SQLite ddi table for these pairs
console.log('Updating SQLite ddi table in batches...');
const updateStmt = db.prepare('UPDATE ddi SET level = ? WHERE ddinter_id_a = ? AND ddinter_id_b = ?');

db.exec('BEGIN TRANSACTION;');
let updated = 0;
for (const [idA, idB] of unknownPairs) {
  const info = updateStmt.run('Unknown', idA, idB);
  if (info && info.changes) {
    updated += Number(info.changes);
  }
}
db.exec('COMMIT;');

console.log(`Successfully updated ${updated} rows to 'Unknown' in SQLite ddi table.`);

// Verify Alprazolam and Diazepam
const alp = db.prepare("SELECT * FROM ddi WHERE (ddinter_id_a='DDInter54' AND ddinter_id_b='DDInter534') OR (ddinter_id_a='DDInter534' AND ddinter_id_b='DDInter54')").all();
console.log('Verification Alprazolam + Diazepam in SQLite:', alp);

const counts = db.prepare('SELECT level, count(*) as count FROM ddi GROUP BY level').all();
console.log('New level distribution in SQLite:', counts);

