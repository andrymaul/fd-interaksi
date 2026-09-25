const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const dns = require('node:dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch {}

const db = new DatabaseSync('./src/data/ddinter_complete.db');
const svgDir = path.resolve('./src/data/structures');
if (!fs.existsSync(svgDir)) fs.mkdirSync(svgDir, { recursive: true });

async function crawlDrug(ddinterId) {
  const url = `https://ddinter2.scbdd.com/server/drug-detail/${encodeURIComponent(ddinterId)}/`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://ddinter2.scbdd.com/server/drug/'
      },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return { success: false, status: res.status };

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
    const atc = dict['ATC Classification'] || '';
    const iupac = dict['IUPAC Name'] || '';
    const inchi = dict['InChI'] || '';
    const smiles = dict['Canonical SMILES'] || '';
    const drugType = dict['Drug Type'] || 'small molecule';

    // Useful Links
    const dbMatch = html.match(/go\.drugbank\.com\/drugs\/(DB\d+)/i);
    const drugbankId = dbMatch ? dbMatch[1] : '';

    const pbMatch = html.match(/pubchem\.ncbi\.nlm\.nih\.gov\/compound\/(\d+)/i) || html.match(/pubchem\.ncbi\.nlm\.nih\.gov\/summary\/summary\.cgi\?sid=(\d+)/i);
    const pubchemId = pbMatch ? pbMatch[1] : '';

    const cmMatch = html.match(/(CHEMBL\d+)/i);
    const chemblId = cmMatch ? cmMatch[1] : '';

    // SVG
    const svgMatch = html.match(/<svg[\s\S]*?<\/svg>/i);
    const svg = svgMatch ? svgMatch[0] : '';
    if (svg) {
      fs.writeFileSync(path.join(svgDir, `${ddinterId}.svg`), svg, 'utf-8');
    }

    // Update SQLite
    db.prepare(`
      UPDATE drugs SET
        name = COALESCE(NULLIF(?, ''), name),
        drug_type = COALESCE(NULLIF(?, ''), drug_type),
        molecular_formula = COALESCE(NULLIF(?, ''), molecular_formula),
        molecular_weight = COALESCE(NULLIF(?, 0), molecular_weight),
        cas_number = COALESCE(NULLIF(?, ''), cas_number),
        description = COALESCE(NULLIF(?, ''), description),
        smiles = COALESCE(NULLIF(?, ''), smiles),
        structure_svg = COALESCE(NULLIF(?, ''), structure_svg),
        pubchem_id = COALESCE(NULLIF(?, ''), pubchem_id),
        drugbank_id = COALESCE(NULLIF(?, ''), drugbank_id),
        chembl_id = COALESCE(NULLIF(?, ''), chembl_id)
      WHERE ddinter_id = ? COLLATE NOCASE
    `).run(
      drugName, drugType, formula, weight, cas, desc, smiles, svg, pubchemId, drugbankId, chemblId, ddinterId
    );

    return {
      success: true,
      ddinterId,
      drugName,
      formula,
      weight,
      drugbankId,
      pubchemId,
      hasSvg: !!svg,
      descLength: desc.length
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function main() {
  const count = parseInt(process.argv[2] || '10', 10);
  console.log(`Checking drugs needing enrichment in SQLite (batch of ${count})...`);

  const rows = db.prepare(`
    SELECT ddinter_id, name FROM drugs 
    WHERE (molecular_formula = '' OR structure_svg = '' OR description = '')
    LIMIT ?
  `).all(count);

  console.log(`Found ${rows.length} drugs to enrich.`);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    console.log(`[${i+1}/${rows.length}] Crawling ${row.ddinter_id} (${row.name})...`);
    const res = await crawlDrug(row.ddinter_id);
    console.log('Result:', res);
    await new Promise(r => setTimeout(r, 600)); // Respectful delay
  }

  const updatedStats = db.prepare(`
    SELECT 
      count(*) as total,
      sum(case when molecular_formula != '' then 1 else 0 end) as withFormula,
      sum(case when structure_svg != '' then 1 else 0 end) as withSvg,
      sum(case when description != '' then 1 else 0 end) as withDesc,
      sum(case when drugbank_id != '' then 1 else 0 end) as withDbId,
      sum(case when pubchem_id != '' then 1 else 0 end) as withPbId
    FROM drugs
  `).get();
  console.log('Updated SQLite Drug Stats:', updatedStats);
}

main().catch(console.error);
