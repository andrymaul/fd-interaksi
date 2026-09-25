const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');

async function getCsrf() {
  const res = await fetch('https://ddinter2.scbdd.com/server/drug/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });
  const html = await res.text();
  const m = html.match(/csrfmiddlewaretoken:\s*'([^']+)'/);
  return m ? m[1] : '';
}

async function fetchPage(csrf, start, length) {
  const body = new URLSearchParams({
    csrfmiddlewaretoken: csrf,
    draw: '1',
    start: String(start),
    length: String(length)
  });

  const res = await fetch('https://ddinter2.scbdd.com/server/drug-source/', {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Cookie': 'csrftoken=' + csrf,
      'Referer': 'https://ddinter2.scbdd.com/server/drug/',
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString(),
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function main() {
  const csrf = await getCsrf();
  console.log('CSRF token:', csrf);

  console.log('Fetching page 0 (length: 50)...');
  const t0 = Date.now();
  const page0 = await fetchPage(csrf, 0, 50);
  console.log(`Page 0: ${page0.data?.length} drugs in ${Date.now() - t0}ms (total: ${page0.recordsTotal})`);

  console.log('Fetching page 1 (length: 50)...');
  const t1 = Date.now();
  const page1 = await fetchPage(csrf, 50, 50);
  console.log(`Page 1: ${page1.data?.length} drugs in ${Date.now() - t1}ms`);
}

main().catch(console.error);
