const https = require('https');

https.get('https://ddinter2.scbdd.com/server/drug-detail/DDInter10/', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Referer': 'https://ddinter2.scbdd.com/server/drug/'
  }
}, res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    const table1 = body.match(/<table id="interaction-table"[\s\S]*?<\/table>/i);
    if (table1) {
      console.log('interaction-table length:', table1[0].length);
      const rows = table1[0].match(/<tr/g) || [];
      console.log('tr count:', rows.length);
      console.log('Table content preview:', table1[0].slice(0, 1000));
    }
    const scripts = body.match(/<script[\s\S]*?<\/script>/gi) || [];
    for (const s of scripts) {
      if (s.includes('interaction-table') || s.includes('bootstrapTable') || s.includes('ajax')) {
        console.log('Script match snippet:');
        console.log(s.replace(/\s+/g, ' ').slice(0, 400));
      }
    }
  });
});
