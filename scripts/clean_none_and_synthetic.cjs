const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('./src/data/ddinter_complete.db');

try {
  db.exec('PRAGMA busy_timeout = 15000;');
} catch (_) {}

console.log('Cleaning literal "None" and synthetic text from SQLite...');

const r1 = db.prepare("UPDATE drugs SET molecular_formula = '' WHERE molecular_formula = 'None' OR molecular_formula = '-'").run();
const r2 = db.prepare("UPDATE drugs SET description = '' WHERE description = 'None' OR description = '-'").run();
const r3 = db.prepare("UPDATE drugs SET cas_number = '' WHERE cas_number = '-' OR cas_number = 'None'").run();
const r4 = db.prepare("UPDATE drugs SET drug_type = 'small molecule' WHERE drug_type = 'None' OR drug_type = ''").run();
const r5 = db.prepare("UPDATE drugs SET therapeutic_class = REPLACE(therapeutic_class, 'Senyawa Farmakologis ', '') WHERE therapeutic_class LIKE 'Senyawa Farmakologis %'").run();

console.log('Result:', {
  formulaCleared: r1.changes,
  descCleared: r2.changes,
  casCleared: r3.changes,
  drugTypeFixed: r4.changes,
  synthClassCleaned: r5.changes
});

// Check DDInter3 specifically
const ddinter3 = db.prepare("SELECT * FROM drugs WHERE ddinter_id = 'DDInter3'").get();
console.log('Updated DDInter3:', ddinter3);
