const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');

async function test() {
  const getRes = await fetch('https://ddinter2.scbdd.com/server/drug/', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  });
  const html = await getRes.text();
  const csrfMatch = html.match(/csrfmiddlewaretoken:\s*'([^']+)'/);
  const csrf = csrfMatch ? csrfMatch[1] : '';

  console.log('CSRF:', csrf);

  const body = new URLSearchParams({
    csrfmiddlewaretoken: csrf,
    draw: '1',
    start: '0',
    length: '90'
  });

  const t0 = Date.now();
  const postRes = await fetch('https://ddinter2.scbdd.com/server/drug-source/', {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Cookie': 'csrftoken=' + csrf,
      'Referer': 'https://ddinter2.scbdd.com/server/drug/',
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  console.log('Status:', postRes.status);
  const json = await postRes.json();
  console.log(`Fetched ${json.data?.length} drugs in ${Date.now() - t0}ms! Total records: ${json.recordsTotal}`);
}

test().catch(console.error);
