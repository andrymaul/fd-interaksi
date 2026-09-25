const https = require('https');
const querystring = require('querystring');

function getSession() {
  return new Promise((resolve, reject) => {
    https.get('https://ddinter2.scbdd.com/server/drug/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    }, (res) => {
      let html = '';
      res.on('data', d => html += d);
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'] || [];
        const cookie = setCookie.map(c => c.split(';')[0]).join('; ');
        const m = html.match(/csrfmiddlewaretoken:\s*'([^']+)'/);
        const csrf = m ? m[1] : '';
        resolve({ cookie, csrf });
      });
    }).on('error', reject);
  });
}

function postTable(endpoint, referer, start, length, cookie, csrf) {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify({
      csrfmiddlewaretoken: csrf,
      draw: '1',
      start: String(start),
      length: String(length)
    });

    const req = https.request(`https://ddinter2.scbdd.com/server/${endpoint}/`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Cookie': cookie,
        'Referer': `https://ddinter2.scbdd.com/server/${referer}/`,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`Failed to parse JSON: ${body.slice(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log('Connecting to https://ddinter2.scbdd.com/ ...');
  const { cookie, csrf } = await getSession();
  console.log('Got cookie:', cookie);
  console.log('Got CSRF token:', csrf);

  console.log('Fetching drug-source test...');
  const res = await postTable('drug-source', 'drug', 0, 5, cookie, csrf);
  console.log('recordsTotal:', res.recordsTotal);
  console.log('recordsFiltered:', res.recordsFiltered);
  console.log('Returned items count:', res.data ? res.data.length : 0);
  if (res.data && res.data.length > 0) {
    const item = res.data[0];
    console.log('Sample item:', {
      name: item.name,
      display: item.display,
      internalID: item.internalID,
      drugbank_id: item.drugbank_id,
      exist: item.exist,
      hasStructure: !!item.structure
    });
  }
}

main().catch(console.error);
