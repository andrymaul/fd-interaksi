const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');

async function test(id) {
  const t0 = Date.now();
  const res = await fetch(`https://ddinter2.scbdd.com/server/drug-detail/${id}/`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Connection': 'keep-alive' },
    signal: AbortSignal.timeout(20000)
  });
  const text = await res.text();
  const descMatch = text.match(/Description[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i);
  console.log(id, 'in', Date.now() - t0, 'ms:', descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim().slice(0, 100) : 'none');
}

(async () => {
  await test('DDInter60');
  await new Promise(r => setTimeout(r, 600));
  await test('DDInter500');
})();
