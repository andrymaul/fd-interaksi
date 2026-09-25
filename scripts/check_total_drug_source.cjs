const dns = require('node:dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch {}

async function checkTotalDrugs() {
  const url = 'https://ddinter2.scbdd.com/server/drug-source/';
  const form = new URLSearchParams();
  form.append('draw', '1');
  form.append('start', '0');
  form.append('length', '1');
  form.append('search[value]', '');
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
    const data = await res.json();
    console.log('Total records in drug-source:', data.recordsTotal);
    console.log('Sample data[0]:', data.data[0]);
  } catch (err) {
    console.error('Error:', err.message);
  }
}

checkTotalDrugs();
