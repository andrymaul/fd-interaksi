const https = require('https');

https.get('https://ddinter2.scbdd.com/server/drug/', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
  }
}, res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    console.log('Status:', res.statusCode, 'Length:', body.length);
    const scripts = body.match(/<script[\s\S]*?<\/script>/gi) || [];
    for (const s of scripts) {
      console.log('--- SCRIPT ---');
      console.log(s.replace(/\s+/g, ' ').slice(0, 500));
    }
  });
});
