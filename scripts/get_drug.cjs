const https = require('https');

const id = process.argv[2] || 'DDInter10';
console.log(`Fetching https://ddinter2.scbdd.com/server/drug-detail/${id}/ ...`);

https.get(`https://ddinter2.scbdd.com/server/drug-detail/${id}/`, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Referer': 'https://ddinter2.scbdd.com/server/drug/'
  }
}, res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    console.log(`Status: ${res.statusCode}, Body length: ${body.length}`);
    const re = /<td[^>]*class="key"[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class="value"[^>]*>([\s\S]*?)<\/td>/gi;
    let m;
    while ((m = re.exec(body)) !== null) {
      const k = m[1].replace(/<[^>]+>/g, '').trim();
      const v = m[2].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ');
      console.log(`[${k}] => [${v}]`);
    }
    const useful = body.match(/Useful Links[\s\S]*?<\/table>/i);
    if (useful) {
      console.log('Useful Links snippet:', useful[0].replace(/\s+/g, ' ').slice(0, 500));
    }
    const svgMatch = body.match(/<svg[\s\S]*?<\/svg>/i);
    console.log('Has SVG:', !!svgMatch, svgMatch ? svgMatch[0].length : 0);
  });
}).on('error', err => console.error(err));
