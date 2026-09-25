const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');

async function testDrugSource() {
  const url = 'https://ddinter2.scbdd.com/server/drug-source/';
  const form = new URLSearchParams();
  form.append('draw', '1');
  form.append('start', '0');
  form.append('length', '10');
  form.append('search[value]', '');
  form.append('search[regex]', 'false');

  try {
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
      signal: AbortSignal.timeout(15000)
    });
    const data = await res.json();
    console.log(`Success in ${Date.now() - t0}ms! Total records:`, data.recordsTotal);
    console.log('Sample data[0]:', Object.keys(data.data[0]));
    console.log('data[0]:', {
      internalID: data.data[0].internalID,
      name: data.data[0].name,
      smiles: data.data[0].smiles,
      hasStructure: !!data.data[0].structure,
      drugbank_id: data.data[0].drugbank_id,
      pubchem_cid: data.data[0].pubchem_cid
    });
  } catch (err) {
    console.error('Error:', err.message);
  }
}

testDrugSource();
