const https = require('https');
const fs = require('fs');

console.log('Testing connection to ddinter2...');
https.get('https://ddinter2.scbdd.com/static/media/download/ddinter_downloads_code_S.csv', {
  headers: {
    'Range': 'bytes=0-1000',
    'User-Agent': 'Mozilla/5.0'
  }
}, (res) => {
  console.log('Status:', res.statusCode);
  console.log('Headers:', res.headers);
  res.on('data', d => console.log('Chunk received, length:', d.length));
  res.on('end', () => console.log('End received'));
}).on('error', (err) => {
  console.error('Error:', err);
});
