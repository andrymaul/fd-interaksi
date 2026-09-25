const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('./src/data/ddinter_complete.db');

const indo = db.prepare("SELECT ddinter_id, name FROM drugs WHERE description LIKE '%adalah%' OR mechanism LIKE '%adalah%'").all();
console.log('Indo rows count:', indo.length);
console.log(indo.map(r => `${r.ddinter_id} (${r.name})`));
