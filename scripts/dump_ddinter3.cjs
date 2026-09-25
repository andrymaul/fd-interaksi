const dns = require('node:dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch {}
const fs = require('fs');

async function dumpDdinter3() {
  const res = await fetch('https://ddinter2.scbdd.com/server/drug-detail/DDInter3/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://ddinter2.scbdd.com/server/drug/'
    }
  });
  const html = await res.text();
  fs.writeFileSync('scripts/ddinter3_raw.html', html, 'utf-8');
  console.log('Saved ddinter3_raw.html, length:', html.length);
}

dumpDdinter3().catch(console.error);
