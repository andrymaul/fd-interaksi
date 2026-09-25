const dns = require('node:dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch {}

async function checkUrl(path) {
  const url = `https://ddinter2.scbdd.com/${path}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000)
    });
    console.log(`[${path}] Status: ${res.status}, Length: ${(await res.text()).length}`);
  } catch (e) {
    console.log(`[${path}] Error: ${e.message}`);
  }
}

async function run() {
  await checkUrl('statistics/');
  await checkUrl('explanation/');
  await checkUrl('download/');
}

run();
