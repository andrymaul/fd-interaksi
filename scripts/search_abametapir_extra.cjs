const dns = require('node:dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch {}

async function search(q) {
  const url = 'https://ddinter2.scbdd.com/server/drug-source/';
  const form = new URLSearchParams();
  form.append('draw', '1');
  form.append('start', '0');
  form.append('length', '10');
  form.append('search[value]', q);
  form.append('search[regex]', 'false');

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://ddinter2.scbdd.com/server/drug/'
      },
      body: form.toString(),
      signal: AbortSignal.timeout(20000)
    });
    const d = await res.json();
    console.log(`Query "${q}": found ${d.recordsFiltered} items:`, d.data.map(x => ({
      name: x.name,
      id: x.internalID,
      db: x.drugbank_id,
      hasStructure: !!x.structure
    })));
  } catch (e) {
    console.error(`Query "${q}" error:`, e.message);
  }
}

async function run() {
  await search('DB14725');
  await search('56180-83-7');
  await search('Xeglyze');
  await search('Abametapir');
}

run();
