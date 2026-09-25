const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('./src/data/ddinter_complete.db');
try {
  db.exec('PRAGMA busy_timeout = 15000;');
} catch (_) {}

const total = db.prepare('SELECT count(*) as c FROM drugs').get().c;
const withDbId = db.prepare("SELECT count(*) as c FROM drugs WHERE drugbank_id != ''").get().c;
const withPubchem = db.prepare("SELECT count(*) as c FROM drugs WHERE pubchem_id != ''").get().c;
const withFormula = db.prepare("SELECT count(*) as c FROM drugs WHERE molecular_formula != ''").get().c;
const withSvg = db.prepare("SELECT count(*) as c FROM drugs WHERE structure_svg != ''").get().c;
const withDesc = db.prepare("SELECT count(*) as c FROM drugs WHERE description != ''").get().c;

console.log({ total, withDbId, withPubchem, withFormula, withSvg, withDesc });
