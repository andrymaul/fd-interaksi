const dns = require('node:dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch {}
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ATC_GROUPS = [
  { idx: 3, code: 'A', name: 'Alimentary Tract And Metabolism', idName: 'Saluran Pencernaan & Metabolisme (Alimentary Tract and Metabolism)' },
  { idx: 4, code: 'B', name: 'Blood And Blood Forming Organs', idName: 'Darah & Organ Pembentuk Darah (Blood and Blood Forming Organs)' },
  { idx: 5, code: 'C', name: 'Cardiovascular System', idName: 'Sistem Kardiovaskular (Cardiovascular System)' },
  { idx: 6, code: 'D', name: 'Dermatologicals', idName: 'Dermatologikal (Dermatologicals)' },
  { idx: 7, code: 'G', name: 'Genito Urinary System And Sex Hormones', idName: 'Sistem Genitourinari & Hormon Kelamin (Genito-Urinary System)' },
  { idx: 8, code: 'H', name: 'Systemic Hormonal Preparations, Excl. Sex Hormones And Insulins', idName: 'Preparat Hormon Sistemik (Systemic Hormonal Preparations)' },
  { idx: 9, code: 'J', name: 'Antiinfectives For Systemic Use', idName: 'Antiinfeksi untuk Penggunaan Sistemik (Antiinfectives for Systemic Use)' },
  { idx: 10, code: 'L', name: 'Antineoplastic And Immunomodulating Agents', idName: 'Agen Antineoplastik & Imunomodulasi (Antineoplastic and Immunomodulating)' },
  { idx: 11, code: 'M', name: 'Musculo-Skeletal System', idName: 'Sistem Muskuloskeletal (Musculo-Skeletal System)' },
  { idx: 12, code: 'N', name: 'Nervous System', idName: 'Sistem Saraf (Nervous System)' },
  { idx: 13, code: 'P', name: 'Antiparasitic Products, Insecticides And Repellents', idName: 'Produk Antiparasit & Insektisida (Antiparasitic Products)' },
  { idx: 14, code: 'R', name: 'Respiratory System', idName: 'Sistem Pernapasan (Respiratory System)' },
  { idx: 15, code: 'S', name: 'Sensory Organs', idName: 'Organ Sensorik (Sensory Organs)' },
  { idx: 16, code: 'V', name: 'Various', idName: 'Agen Diagnostik & Lainnya (Various / Diagnostic Agents)' }
];

const JSON_PATH = path.join(__dirname, '../src/data/ddinter_official_atc_groups.json');

async function fetchPage(idx, start, length = 35) {
  const form = new URLSearchParams();
  form.append('draw', '1');
  form.append('start', String(start));
  form.append('length', String(length));
  form.append('search[value]', '');
  form.append('search[regex]', 'false');
  form.append('type', 'atc');
  form.append('idx', String(idx));

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch('https://ddinter2.scbdd.com/server/drug-source/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://ddinter2.scbdd.com/server/drug/'
        },
        body: form.toString(),
        signal: AbortSignal.timeout(20000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn(`    [Attempt ${attempt}/4] idx=${idx} start=${start}: ${e.message}`);
      if (attempt === 4) throw e;
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
}

async function main() {
  console.log('=== Harvesting Official DDInter ATC Classifications (https://ddinter2.scbdd.com/) ===');

  let state = {
    completedGroups: [],
    drugs: {}, // internalID -> { ddinterId, name, drugbank_id, atcGroups: [] }
    groupStats: {}
  };

  if (fs.existsSync(JSON_PATH)) {
    try {
      state = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8'));
      console.log(`Loaded existing state: ${state.completedGroups?.length || 0} groups previously completed, ${Object.keys(state.drugs || {}).length} drugs.`);
    } catch {}
  }
  if (!state.completedGroups) state.completedGroups = [];
  if (!state.drugs) state.drugs = {};
  if (!state.groupStats) state.groupStats = {};

  const pageSize = 35;

  for (const g of ATC_GROUPS) {
    if (state.completedGroups.includes(g.code)) {
      console.log(`[SKIPPING] Group ${g.code} (${g.name}) - already completed.`);
      continue;
    }

    console.log(`\n>>> [START] Group ${g.code}: ${g.name} (idx=${g.idx})`);
    let start = 0;
    let total = 0;
    let fetched = 0;

    while (true) {
      const data = await fetchPage(g.idx, start, pageSize);
      total = data.recordsTotal;
      const rows = data.data || [];
      if (rows.length === 0) break;

      for (const row of rows) {
        const id = row.internalID;
        if (!state.drugs[id]) {
          state.drugs[id] = {
            ddinterId: id,
            name: row.name,
            drugbank_id: row.drugbank_id,
            atcGroups: []
          };
        }
        if (!state.drugs[id].atcGroups.includes(g.code)) {
          state.drugs[id].atcGroups.push(g.code);
        }
      }

      fetched += rows.length;
      console.log(`  Group ${g.code}: fetched ${fetched}/${total} drugs`);
      if (fetched >= total) break;
      start += pageSize;
      await new Promise(r => setTimeout(r, 250));
    }

    state.groupStats[g.code] = {
      name: g.name,
      idName: g.idName,
      total
    };
    state.completedGroups.push(g.code);

    // Persist progress to JSON
    fs.writeFileSync(JSON_PATH, JSON.stringify(state, null, 2), 'utf-8');
    console.log(`  Saved progress: ${state.completedGroups.length}/14 groups done.`);
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n========================================`);
  console.log(`Harvest complete! Total unique drugs categorized: ${Object.keys(state.drugs).length}`);
  console.log(`========================================`);
}

main().catch(console.error);
