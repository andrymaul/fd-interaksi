const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('./src/data/ddinter_complete.db');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('--- DATABASE OVERVIEW ---');
for (const t of tables) {
  try {
    const count = db.prepare(`SELECT count(*) as c FROM "${t.name}"`).get().c;
    console.log(`${t.name}: ${count}`);
  } catch (err) {
    console.error(`Error querying ${t.name}:`, err.message);
  }
}
