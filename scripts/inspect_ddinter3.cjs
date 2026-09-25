const dns = require('node:dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch {}
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('./src/data/ddinter_complete.db');

async function main() {
  const row = db.prepare("SELECT * FROM drugs WHERE ddinter_id = 'DDInter3'").get();
  console.log('=== SQLite Record for DDInter3 ===');
  console.log(row);

  console.log('\n=== Fetching https://ddinter2.scbdd.com/server/drug-detail/DDInter3/ ===');
  const res = await fetch('https://ddinter2.scbdd.com/server/drug-detail/DDInter3/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://ddinter2.scbdd.com/server/drug/'
    },
    signal: AbortSignal.timeout(15000)
  });
  const html = await res.text();
  console.log('HTML Length:', html.length);

  const kvRe = /<td[^>]*class=["']key["'][^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class=["']value["'][^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = kvRe.exec(html)) !== null) {
    const k = m[1].replace(/<[^>]+>/g, '').trim();
    const v = m[2].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ');
    console.log(`[KEY-VAL] "${k}" ===> "${v}"`);
  }

  // Also check if there are other table structures or divs
  const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  // Look for SMILES, formula, DrugBank, PubChem anywhere in HTML
  console.log('\n--- Regex Search in HTML ---');
  console.log('DrugBank match:', html.match(/DB\d+/g));
  console.log('PubChem CID match:', html.match(/pubchem.*?(\d+)/i));
  console.log('Formula match:', html.match(/[A-Z][a-z]?\d*(?:[A-Z][a-z]?\d*)*/g)?.filter(s => s.length > 4 && /\d/.test(s)).slice(0, 10));
  console.log('SVG present:', html.includes('<svg'));
  if (html.includes('<svg')) {
    console.log('SVG snippet:', html.slice(html.indexOf('<svg'), html.indexOf('</svg>') + 6).slice(0, 200));
  }
}

main().catch(console.error);
