const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('./src/data/ddinter_complete.db');

const descNone = db.prepare("SELECT count(*) as c FROM drugs WHERE description = 'None'").get().c;
const formulaNone = db.prepare("SELECT count(*) as c FROM drugs WHERE molecular_formula = 'None'").get().c;
const casDash = db.prepare("SELECT count(*) as c FROM drugs WHERE cas_number = '-'").get().c;
const synthClass = db.prepare("SELECT count(*) as c FROM drugs WHERE therapeutic_class LIKE 'Senyawa Farmakologis%'").get().c;
const emptyFormula = db.prepare("SELECT count(*) as c FROM drugs WHERE molecular_formula = '' OR molecular_formula = 'None'").get().c;

console.log({ descNone, formulaNone, casDash, synthClass, emptyFormula });
