const https = require('https');
const fs = require('fs');
const path = require('path');

function getFileSize(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Status ${res.statusCode}`));
      }
      resolve(parseInt(res.headers['content-length'], 10));
    });
    req.on('error', reject);
    req.end();
  });
}

function fetchChunk(url, start, end) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: {
        'Range': `bytes=${start}-${end}`,
        'User-Agent': 'Mozilla/5.0'
      }
    };
    https.get(url, opts, res => {
      if (res.statusCode !== 206 && res.statusCode !== 200) {
        return reject(new Error(`Status ${res.statusCode} on range ${start}-${end}`));
      }
      const bufs = [];
      res.on('data', d => bufs.push(d));
      res.on('end', () => resolve(Buffer.concat(bufs)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function downloadFileChunked(letter) {
  const url = `https://ddinter2.scbdd.com/static/media/download/ddinter_downloads_code_${letter}.csv`;
  const dest = path.join(__dirname, '../data_harvest', `ddinter_downloads_code_${letter}.csv`);
  console.log(`\n[${letter}] Checking size at ${url}...`);

  const total = await getFileSize(url);
  console.log(`[${letter}] Total size: ${total} bytes (${(total / 1024 / 1024).toFixed(2)} MB)`);

  const chunkSize = 256 * 1024; // 256 KB chunks
  const fd = fs.openSync(dest, 'w');
  let offset = 0;

  while (offset < total) {
    const end = Math.min(offset + chunkSize - 1, total - 1);
    let attempts = 0;
    let success = false;
    let chunk;

    while (attempts < 5 && !success) {
      attempts++;
      try {
        chunk = await fetchChunk(url, offset, end);
        success = true;
      } catch (e) {
        console.warn(`[${letter}] Retry ${attempts} at range ${offset}-${end}: ${e.message}`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!success) {
      fs.closeSync(fd);
      throw new Error(`Failed to download chunk ${offset}-${end} after 5 attempts`);
    }

    fs.writeSync(fd, chunk);
    offset += chunk.length;
    process.stdout.write(`[${letter}] Progress: ${offset} / ${total} bytes (${Math.round((offset/total)*100)}%)\r`);
  }

  fs.closeSync(fd);
  console.log(`\n[${letter}] Successfully completed! Final size: ${fs.statSync(dest).size} bytes`);
}

async function main() {
  const letters = ['S', 'U'];
  for (const l of letters) {
    try {
      await downloadFileChunked(l);
    } catch (e) {
      console.error(`Error downloading ${l}:`, e);
    }
  }
}

main();
