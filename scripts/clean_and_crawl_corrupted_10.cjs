const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const dns = require('node:dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch {}

const db = new DatabaseSync('./src/data/ddinter_complete.db');
const svgDir = path.resolve('./src/data/structures');
if (!fs.existsSync(svgDir)) fs.mkdirSync(svgDir, { recursive: true });

async function crawlAndClean(ddinterId) {
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
      const atc = dict['ATC Classification'] || '';

      // DrugBank
      const dbMatch = html.match(/go\.drugbank\.com\/drugs\/(DB\d+)/i) || html.match(/href="[^"]*drugbank[^"]*"(?:[^>]*)>(DB\d+)</i);
      const drugbankId = dbMatch ? dbMatch[1] : '';

      // PubChem
      const pbMatch = html.match(/pubchem\.ncbi\.nlm\.nih\.gov\/compound\/(\d+)/i) || html.match(/pubchem\.ncbi\.nlm\.nih\.gov\/summary\/summary\.cgi\?sid=(\d+)/i) || html.match(/PubChem CID[\s\S]*?<td[^>]*>(\d+)<\/td>/i);
      const pubchemId = pbMatch ? pbMatch[1] : '';

      // ChEMBL
      const cmMatch = html.match(/(CHEMBL\d+)/i);
      const chemblId = cmMatch ? cmMatch[1] : '';

      // SVG
      const svgMatch = html.match(/<svg[\s\S]*?<\/svg>/i);
      const svg = svgMatch ? svgMatch[0] : '';
      if (svg) {
        fs.writeFileSync(path.join(svgDir, `${ddinterId}.svg`), svg, 'utf-8');
      }

      // Explicitly overwrite the old corrupted data with authentic DDInter 2.0 data!
      db.prepare(`
        UPDATE drugs SET
          name = COALESCE(NULLIF(?, ''), name),
          drug_type = COALESCE(NULLIF(?, ''), drug_type),
          molecular_formula = COALESCE(NULLIF(?, ''), molecular_formula),
          molecular_weight = COALESCE(NULLIF(?, 0), molecular_weight),
          cas_number = COALESCE(NULLIF(?, ''), cas_number),
          description = ?,
          mechanism = '',
          smiles = COALESCE(NULLIF(?, ''), smiles),
          structure_svg = CASE WHEN ? != '' THEN ? ELSE structure_svg END,
          pubchem_id = COALESCE(NULLIF(?, ''), pubchem_id),
          drugbank_id = COALESCE(NULLIF(?, ''), drugbank_id),
          chembl_id = COALESCE(NULLIF(?, ''), chembl_id)
        WHERE ddinter_id = ? COLLATE NOCASE
      `).run(
        drugName, drugType, formula, weight, cas, desc, smiles, svg, svg, pubchemId, drugbankId, chemblId, ddinterId
      );

      console.log(`[CLEANED ${ddinterId}] ${drugName}: formula=${formula}, db=${drugbankId}, desc="${desc.slice(0, 60)}..."`);
      return { success: true, ddinterId };
    } catch (err) {
      if (attempt === 3) {
        console.error(`[ERROR ${ddinterId}]:`, err.message);
        return { success: false, ddinterId, error: err.message };
      }
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
}

async function main() {
  const ids = [
    'DDInter1',
    'DDInter14',
    'DDInter500',
    'DDInter60',
    'DDInter4',
    'DDInter15',
    'DDInter1500',
    'DDInter1000',
    'DDInter2',
    'DDInter2000'
  ];

  console.log(`Cleaning and fetching authentic DDInter data for ${ids.length} drugs...`);
  for (const id of ids) {
    await crawlAndClean(id);
    await new Promise(r => setTimeout(r, 400));
  }
  console.log('Finished cleaning specified drugs.');
}

main().catch(console.error);
