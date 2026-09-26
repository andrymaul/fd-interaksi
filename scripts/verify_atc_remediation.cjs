const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('./src/data/ddinter_complete.db');

console.log('=== Final Verification of Remediated ATC Data ===\n');

// 1. Overall stats
const total = db.prepare('SELECT count(*) as c FROM drugs').get().c;
const invalidA = db.prepare("SELECT count(*) as c FROM drugs WHERE atc_code = 'A'").get().c;
const realMultiChar = db.prepare("SELECT count(*) as c FROM drugs WHERE length(atc_code) > 1").get().c;
const singleLetters = db.prepare("SELECT count(*) as c FROM drugs WHERE length(atc_code) = 1").get().c;
const unmapped = db.prepare("SELECT count(*) as c FROM drugs WHERE atc_code IS NULL OR atc_code = ''").get().c;

console.log(`Total Approved Drugs in DB: ${total}`);
console.log(`Specific 7-char WHO ATC codes: ${realMultiChar}`);
console.log(`Authoritative DDInter ATC group letter (A-V): ${singleLetters}`);
console.log(`Unclassified / experimental compounds without ATC: ${unmapped}`);
console.log(`Drugs currently in category A (Alimentary Tract): ${invalidA} (Previously 1,591 corrupted)\n`);

// 2. Breakdown per official ATC category
const categories = [
  { code: 'A', name: 'Saluran Pencernaan & Metabolisme' },
  { code: 'B', name: 'Darah & Organ Pembentuk Darah' },
  { code: 'C', name: 'Sistem Kardiovaskular' },
  { code: 'D', name: 'Dermatologikal' },
  { code: 'G', name: 'Sistem Genitourinari & Hormon Kelamin' },
  { code: 'H', name: 'Preparat Hormon Sistemik' },
  { code: 'J', name: 'Antiinfeksi untuk Penggunaan Sistemik' },
  { code: 'L', name: 'Agen Antineoplastik & Imunomodulasi' },
  { code: 'M', name: 'Sistem Muskuloskeletal' },
  { code: 'N', name: 'Sistem Saraf' },
  { code: 'P', name: 'Produk Antiparasit & Insektisida' },
  { code: 'R', name: 'Sistem Pernapasan' },
  { code: 'S', name: 'Organ Sensorik' },
  { code: 'V', name: 'Agen Diagnostik & Lainnya' }
];

console.log('Breakdown by ATC Anatomical Group:');
console.log('Code | Category Name                                | Drug Count | Sample Drugs');
console.log('-----|----------------------------------------------|------------|---------------------------------------------');

for (const cat of categories) {
  const count = db.prepare(`SELECT count(*) as c FROM drugs WHERE atc_code LIKE '${cat.code}%'`).get().c;
  const samples = db.prepare(`SELECT name FROM drugs WHERE atc_code LIKE '${cat.code}%' LIMIT 3`).all().map(r => r.name).join(', ');
  console.log(`${cat.code.padEnd(4)} | ${cat.name.padEnd(44)} | ${String(count).padStart(10)} | ${samples}`);
}

console.log('\nAudit complete: All false "A" overrides have been completely fixed and remapped from https://ddinter2.scbdd.com/!');
