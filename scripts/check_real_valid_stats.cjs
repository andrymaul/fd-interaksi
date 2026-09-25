const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('./src/data/ddinter_complete.db');

const total = db.prepare('SELECT count(*) as c FROM drugs').get().c;
const withFormula = db.prepare("SELECT count(*) as c FROM drugs WHERE molecular_formula != '' AND molecular_formula != 'None'").get().c;
const withSvg = db.prepare("SELECT count(*) as c FROM drugs WHERE structure_svg != ''").get().c;
const withDesc = db.prepare("SELECT count(*) as c FROM drugs WHERE description != '' AND description != 'None'").get().c;
const withDbId = db.prepare("SELECT count(*) as c FROM drugs WHERE drugbank_id != '' AND drugbank_id != 'None'").get().c;
const withPubchem = db.prepare("SELECT count(*) as c FROM drugs WHERE pubchem_id != '' AND pubchem_id != 'None'").get().c;

console.log('=== REAL VALID STATS IN SQLITE ===', {
  total,
  withFormula,
  withSvg,
  withDesc,
  withDbId,
  withPubchem
});

// Check sample drugs with empty/none fields
const sampleEmpty = db.prepare("SELECT ddinter_id, name, molecular_formula, description FROM drugs WHERE description = '' OR description = 'None' LIMIT 10").all();
console.log('Sample drugs with empty/None description:', sampleEmpty);
