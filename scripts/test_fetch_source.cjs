const dns = require('node:dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch {}

async function testFetchSource(start, length) {
  const url = 'https://ddinter2.scbdd.com/server/drug-source/';
  const form = new URLSearchParams();
  form.append('draw', '1');
  form.append('start', String(start));
  form.append('length', String(length));
  form.append('search[value]', '');
  form.append('search[regex]', 'false');

  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://ddinter2.scbdd.com/server/drug/'
    },
    body: form.toString(),
    signal: AbortSignal.timeout(30000)
  });
  const data = await res.json();
  console.log(`Fetched ${data.data.length} drugs (start=${start}) in ${Date.now() - t0}ms!`);
  console.log('Sample item:', {
    name: data.data[0].name,
    internalID: data.data[0].internalID,
    drugbank_id: data.data[0].drugbank_id,
    hasStructure: !!data.data[0].structure,
    smiles: data.data[0].smiles,
    exist: data.data[0].exist
  });
}

testFetchSource(0, 10).catch(console.error);
