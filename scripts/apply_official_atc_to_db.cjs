const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, '../src/data/ddinter_complete.db');
const JSON_PATH = path.join(__dirname, '../src/data/ddinter_official_atc_groups.json');

const ATC_DESCRIPTIONS = {
  A: { name: 'Alimentary Tract and Metabolism', idName: 'Saluran Pencernaan & Metabolisme (Alimentary Tract and Metabolism)' },
  B: { name: 'Blood and Blood Forming Organs', idName: 'Darah & Organ Pembentuk Darah (Blood and Blood Forming Organs)' },
  C: { name: 'Cardiovascular System', idName: 'Sistem Kardiovaskular (Cardiovascular System)' },
  D: { name: 'Dermatologicals', idName: 'Dermatologikal (Dermatologicals)' },
  G: { name: 'Genito Urinary System and Sex Hormones', idName: 'Sistem Genitourinari & Hormon Kelamin (Genito-Urinary System)' },
  H: { name: 'Systemic Hormonal Preparations', idName: 'Preparat Hormon Sistemik (Systemic Hormonal Preparations)' },
  J: { name: 'Antiinfectives for Systemic Use', idName: 'Antiinfeksi untuk Penggunaan Sistemik (Antiinfectives for Systemic Use)' },
  L: { name: 'Antineoplastic and Immunomodulating Agents', idName: 'Agen Antineoplastik & Imunomodulasi (Antineoplastic and Immunomodulating)' },
  M: { name: 'Musculo-Skeletal System', idName: 'Sistem Muskuloskeletal (Musculo-Skeletal System)' },
  N: { name: 'Nervous System', idName: 'Sistem Saraf (Nervous System)' },
  P: { name: 'Antiparasitic Products', idName: 'Produk Antiparasit & Insektisida (Antiparasitic Products)' },
  R: { name: 'Respiratory System', idName: 'Sistem Pernapasan (Respiratory System)' },
  S: { name: 'Sensory Organs', idName: 'Organ Sensorik (Sensory Organs)' },
  V: { name: 'Various', idName: 'Agen Diagnostik & Lainnya (Various / Diagnostic Agents)' }
};

function main() {
  console.log('=== Applying Official DDInter ATC Mapping to SQLite Database ===');
  
  if (!fs.existsSync(JSON_PATH)) {
    console.error('JSON file does not exist yet:', JSON_PATH);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
  const drugsMap = data.drugs || {};
  console.log(`Loaded ${Object.keys(drugsMap).length} categorized drugs from official DDInter harvest.`);

  const db = new DatabaseSync(DB_PATH);

  // 1. Audit current database state
  const beforeStats = db.prepare(`
    SELECT 
      count(*) as total,
      sum(case when length(atc_code) = 1 then 1 else 0 end) as length1,
      sum(case when atc_code = 'A' then 1 else 0 end) as codeA,
      sum(case when length(atc_code) > 1 then 1 else 0 end) as multiChar,
      sum(case when atc_code is null or atc_code = '' then 1 else 0 end) as emptyCount
    FROM drugs
  `).get();
  console.log('Current DB Stats before cleanup:', beforeStats);

  // 2. Clear corrupted 1-letter entries inside transaction
  db.exec('BEGIN TRANSACTION');
  try {
    console.log('Purging corrupted single-letter ATC codes...');
    db.prepare(`
      UPDATE drugs
      SET atc_code = '', atc_category = '', therapeutic_class = ''
      WHERE length(atc_code) <= 1
    `).run();

    // 3. Prepare statements once
    const selectExistingStmt = db.prepare('SELECT atc_code, therapeutic_class FROM drugs WHERE ddinter_id = ? COLLATE NOCASE');
    const updateStmt = db.prepare(`
      UPDATE drugs
      SET 
        atc_code = ?,
        atc_category = ?,
        therapeutic_class = ?
      WHERE ddinter_id = ? COLLATE NOCASE
    `);

    console.log('Applying official DDInter classifications...');
    let updatedCount = 0;
    let preservedMultiChar = 0;

    for (const [ddinterId, d] of Object.entries(drugsMap)) {
      const groups = d.atcGroups || [];
      if (groups.length === 0) continue;

      const primaryGroup = groups[0];
      const groupInfo = ATC_DESCRIPTIONS[primaryGroup] || { name: primaryGroup, idName: primaryGroup };
      
      const existing = selectExistingStmt.get(ddinterId);
      let codeToSet = primaryGroup;
      if (existing && existing.atc_code && existing.atc_code.length > 1) {
        codeToSet = existing.atc_code;
        preservedMultiChar++;
      }

      const categoryText = groups.length > 1 
        ? groups.map(g => ATC_DESCRIPTIONS[g]?.idName || g).join(' • ')
        : groupInfo.idName;

      let thClass = groupInfo.name;
      if (existing && existing.therapeutic_class && existing.therapeutic_class !== 'Saluran Pencernaan & Metabolisme' && !existing.therapeutic_class.includes('Senyawa Farmakologis')) {
        thClass = existing.therapeutic_class;
      }

      updateStmt.run(codeToSet, categoryText, thClass, ddinterId);
      updatedCount++;
    }

    db.exec('COMMIT');
    console.log(`Successfully committed updates: ${updatedCount} drugs updated (${preservedMultiChar} preserved with multi-char WHO ATC codes).`);
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  // 4. Audit final database state
  const afterStats = db.prepare(`
    SELECT 
      count(*) as total,
      sum(case when length(atc_code) = 1 then 1 else 0 end) as length1,
      sum(case when atc_code = 'A' then 1 else 0 end) as codeA,
      sum(case when length(atc_code) > 1 then 1 else 0 end) as multiChar,
      sum(case when atc_code is null or atc_code = '' then 1 else 0 end) as emptyCount
    FROM drugs
  `).get();
  console.log('\nDB Stats after official application:', afterStats);

  // Print distribution of ATC codes now
  const dist = db.prepare(`
    SELECT 
      case when length(atc_code) > 1 then 'WHO-7-CHAR' when atc_code = '' then 'NONE' else atc_code end as atc_group,
      count(*) as count
    FROM drugs
    GROUP BY atc_group
    ORDER BY count DESC
  `).all();
  console.log('\nNew Authentic Distribution from https://ddinter2.scbdd.com/:');
  console.table(dist);
}

main();
