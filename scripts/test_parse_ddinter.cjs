const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');

async function testFetch(id) {
  const url = `https://ddinter2.scbdd.com/server/drug-detail/${id}/`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Referer': 'https://ddinter2.scbdd.com/'
    },
    signal: AbortSignal.timeout(10000)
  });
  const html = await res.text();

  // Basic regex extractors matching DDInter HTML structure
  const nameMatch = html.match(/<h2[^>]*>([^<]+)<\/h2>/i) || html.match(/<strong>\s*Drug Name\s*<\/strong>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i);
  
  // Clean description
  let desc = '';
  const descMatch = html.match(/Description[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i) || html.match(/Description[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
  if (descMatch) {
    desc = descMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // Formula
  let formula = '';
  const formulaMatch = html.match(/Molecular Formula[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i);
  if (formulaMatch) formula = formulaMatch[1].replace(/<[^>]+>/g, '').trim();

  // DrugBank
  let drugbank = '';
  const dbMatch = html.match(/go\.drugbank\.com\/drugs\/(DB\d+)/i) || html.match(/href="[^"]*drugbank[^"]*"(?:[^>]*)>(DB\d+)</i);
  if (dbMatch) drugbank = dbMatch[1];

  // PubChem
  let pubchem = '';
  const pcMatch = html.match(/pubchem\.ncbi\.nlm\.nih\.gov\/compound\/(\d+)/i) || html.match(/PubChem CID[\s\S]*?<td[^>]*>(\d+)<\/td>/i);
  if (pcMatch) pubchem = pcMatch[1];

  console.log(`[${id}] Result:`, {
    formula,
    drugbank,
    pubchem,
    descSnippet: desc.slice(0, 100)
  });
}

async function main() {
  for (const id of ['DDInter1', 'DDInter2', 'DDInter4', 'DDInter14', 'DDInter60', 'DDInter500']) {
    try {
      await testFetch(id);
    } catch (e) {
      console.error(id, e.message);
    }
  }
}

main();
