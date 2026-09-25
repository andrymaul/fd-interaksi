const dns = require('node:dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch {}

async function dump(path) {
  const res = await fetch(`https://ddinter2.scbdd.com/${path}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(15000)
  });
  const html = await res.text();
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                   .replace(/<style[\s\S]*?<\/style>/gi, '')
                   .replace(/<[^>]+>/g, ' ')
                   .replace(/\s+/g, ' ');
  console.log(`=== ${path} ===`);
  console.log(text.slice(0, 1500));
}

async function run() {
  await dump('explanation/');
  await dump('statistics/');
}

run();
