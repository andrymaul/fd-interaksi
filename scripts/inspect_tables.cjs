const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('./src/data/ddinter_complete.db');

for (const t of ['drugs', 'ddi', 'dfi', 'ddsi', 'dupli', 'ddi_mechanisms']) {
  console.log('=== TABLE:', t);
  const info = db.prepare(`PRAGMA table_info("${t}")`).all();
  console.log(info.map(c => `${c.name} (${c.type})`).join(', '));
  const sample = db.prepare(`SELECT * FROM "${t}" LIMIT 1`).get();
  console.log('Sample:', JSON.stringify(sample, null, 2));
}
