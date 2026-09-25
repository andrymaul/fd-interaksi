const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const dns = require('node:dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch {}

const db = new DatabaseSync('./src/data/ddinter_complete.db');
const svgDir = path.resolve('./src/data/structures');
if (!fs.existsSync(svgDir)) fs.mkdirSync(svgDir, { recursive: true });

const updateStmt = db.prepare(`
  UPDATE drugs SET
    name = COALESCE(NULLIF(?, ''), name),
    drug_type = COALESCE(NULLIF(?, ''), drug_type),
    molecular_formula = COALESCE(NULLIF(?, ''), molecular_formula),
    molecular_weight = COALESCE(NULLIF(?, 0), molecular_weight),
    cas_number = COALESCE(NULLIF(?, ''), cas_number),
    description = COALESCE(NULLIF(?, ''), description),
    smiles = COALESCE(NULLIF(?, ''), smiles),
    structure_svg = CASE WHEN ? != '' THEN ? ELSE structure_svg END,
    pubchem_id = COALESCE(NULLIF(?, ''), pubchem_id),
    drugbank_id = COALESCE(NULLIF(?, ''), drugbank_id),
    chembl_id = COALESCE(NULLIF(?, ''), chembl_id)
  WHERE ddinter_id = ? COLLATE NOCASE
`);

async function crawlDrug(ddinterId) {
  const url = `https://ddinter2.scbdd.com/server/drug-detail/${encodeURIComponent(ddinterId)}/`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://ddinter2.scbdd.com/server/drug/',
          'Connection': 'keep-alive'
        },
        signal: AbortSignal.timeout(20000)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const html = await res.text();
      const kvRe = /<td[^>]*class=["']key["'][^>]*>([\s\S]*?)<\/td>\s*<td[^>]*class=["']value["'][^>]*>([\s\S]*?)<\/td>/gi;
      const dict = {};
      let m;
      while ((m = kvRe.exec(html)) !== null) {
        const k = m[1].replace(/<[^>]+>/g, '').trim();
        const v = m[2].replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ');
        if (k && v) dict[k] = v;
      }

      const drugName = dict['Name'] || dict['Display Name'] || '';
      const formula = dict['Molecular Formula'] || dict['Chemical Formula'] || '';
      const weight = parseFloat(dict['Molecular Weight'] || dict['Average Weight'] || '0') || 0;
      const cas = dict['CAS Number'] && dict['CAS Number'] !== '-' ? dict['CAS Number'] : '';
      const desc = dict['Description'] && dict['Description'] !== 'None' ? dict['Description'] : '';
      const smiles = dict['Canonical SMILES'] || '';
      const drugType = dict['Drug Type'] || 'small molecule';

      // DrugBank ID
      const dbMatch = html.match(/go\.drugbank\.com\/drugs\/(DB\d+)/i) || html.match(/href="[^"]*drugbank[^"]*"(?:[^>]*)>(DB\d+)</i);
      const drugbankId = dbMatch ? dbMatch[1] : '';

      // PubChem CID
      const pbMatch = html.match(/pubchem\.ncbi\.nlm\.nih\.gov\/compound\/(\d+)/i) ||
                      html.match(/pubchem\.ncbi\.nlm\.nih\.gov\/summary\/summary\.cgi\?sid=(\d+)/i) ||
                      html.match(/PubChem CID[\s\S]*?<td[^>]*>(\d+)<\/td>/i);
      const pubchemId = pbMatch ? pbMatch[1] : '';

      // ChEMBL ID
      const cmMatch = html.match(/(CHEMBL\d+)/i);
      const chemblId = cmMatch ? cmMatch[1] : '';

      // 2D Structure SVG
      const svgMatch = html.match(/<svg[\s\S]*?<\/svg>/i);
      const svg = svgMatch ? svgMatch[0] : '';
      if (svg) {
        try {
          fs.writeFileSync(path.join(svgDir, `${ddinterId}.svg`), svg, 'utf-8');
        } catch {}
      }

      // Update SQLite
      updateStmt.run(
        drugName, drugType, formula, weight, cas, desc, smiles, svg, svg, pubchemId, drugbankId, chemblId, ddinterId
      );

      return { success: true, ddinterId, formula, hasSvg: !!svg, hasDesc: !!desc };
    } catch (err) {
      if (attempt === 3) return { success: false, ddinterId, error: err.message };
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

let completedCount = 0;
let errorCount = 0;
const totalToCrawl = { val: 0 };

async function worker(queue, startTime) {
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;
    const res = await crawlDrug(item.ddinter_id);
    completedCount++;
    if (!res.success) errorCount++;

    if (completedCount % 25 === 0 || queue.length === 0) {
      const elapsedSec = (Date.now() - startTime) / 1000;
      const rate = completedCount / elapsedSec;
      const remainingSec = Math.round(queue.length / (rate || 1));
      console.log(`[Progress ${completedCount}/${totalToCrawl.val}] (${Math.round(completedCount/totalToCrawl.val*100)}%) - Rate: ${rate.toFixed(1)} drugs/s, Errors: ${errorCount}, ETA: ${Math.round(remainingSec/60)}m ${remainingSec%60}s`);
    }

    // Small delay to be polite to the DDInter CSU server
    await new Promise(r => setTimeout(r, 150));
  }
}

async function main() {
  const maxLimit = parseInt(process.argv[2] || '0', 10);
  const query = maxLimit > 0
    ? `SELECT ddinter_id, name FROM drugs WHERE (molecular_formula = '' OR structure_svg = '' OR description = '') LIMIT ${maxLimit}`
    : `SELECT ddinter_id, name FROM drugs WHERE (molecular_formula = '' OR structure_svg = '' OR description = '')`;

  const rows = db.prepare(query).all();
  totalToCrawl.val = rows.length;
  console.log(`Starting continuous DDInter 2.0 harvester for ${rows.length} drugs with 6 concurrent workers...`);

  if (rows.length === 0) {
    console.log('All approved drugs are already 100% enriched with DDInter 2.0 data!');
    return;
  }

  const queue = [...rows];
  const startTime = Date.now();
  const concurrency = 6;
  const workers = Array.from({ length: concurrency }, () => worker(queue, startTime));

  await Promise.all(workers);
  const totalElapsed = (Date.now() - startTime) / 1000;
  console.log(`Harvest complete! Processed ${completedCount} drugs in ${Math.round(totalElapsed/60)}m ${Math.round(totalElapsed%60)}s. Errors: ${errorCount}`);

  const finalStats = db.prepare(`
    SELECT 
      count(*) as total,
      sum(case when molecular_formula != '' then 1 else 0 end) as withFormula,
      sum(case when structure_svg != '' then 1 else 0 end) as withSvg,
      sum(case when description != '' then 1 else 0 end) as withDesc,
      sum(case when drugbank_id != '' then 1 else 0 end) as withDbId,
      sum(case when pubchem_id != '' then 1 else 0 end) as withPbId
    FROM drugs
  `).get();
  console.log('Final SQLite DDInter Approved Drugs Summary:', finalStats);
}

main().catch(console.error);
