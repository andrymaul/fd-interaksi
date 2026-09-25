const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('./src/data/ddinter_complete.db');

const interactions = db.prepare(`
  SELECT * FROM ddi 
  WHERE ddinter_id_a = 'DDInter3' OR ddinter_id_b = 'DDInter3'
  LIMIT 5
`).all();

console.log('Sample DDInter3 interactions:', interactions);
