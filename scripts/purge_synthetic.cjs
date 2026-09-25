const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('./src/data/ddinter_complete.db');

const r1 = db.prepare("UPDATE drugs SET description = '' WHERE description LIKE 'Senyawa farmakologis%'").run();
const r2 = db.prepare("UPDATE drugs SET mechanism = '' WHERE mechanism LIKE 'Agen terapeutik%'").run();

console.log('Purged synthetic text:', {
  descUpdated: r1.changes,
  mechUpdated: r2.changes
});
