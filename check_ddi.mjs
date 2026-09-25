import { DatabaseSync } from 'node:sqlite';
import path from 'path';

const db = new DatabaseSync(path.resolve('./src/data/ddinter_complete.db'));
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Tables:', tables);

for (const t of tables) {
  const info = db.prepare(`PRAGMA table_info(${t.name})`).all();
  console.log('Table:', t.name, info.map(c => c.name));
}

const alprazolamDiazepam = db.prepare(`
  SELECT * FROM ddi 
  WHERE (ddinter_id_a = 'DDInter54' AND ddinter_id_b = 'DDInter534')
     OR (ddinter_id_a = 'DDInter534' AND ddinter_id_b = 'DDInter54')
     OR (drug_a LIKE '%alprazolam%' AND drug_b LIKE '%diazepam%')
     OR (drug_a LIKE '%diazepam%' AND drug_b LIKE '%alprazolam%')
`).all();
console.log('Alprazolam - Diazepam rows in DB:', alprazolamDiazepam);
