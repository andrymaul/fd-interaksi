const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');

async function checkApi() {
  console.log('=== VERIFYING API PURITY & ACCURACY ===');

  // 1. Health
  try {
    const res = await fetch('http://localhost:3001/api/health');
    const data = await res.json();
    console.log('1. /api/health:', {
      status: data.status,
      dataSource: data.dataSource,
      totalApprovedDrugs: data.stats?.totalApprovedDrugs,
      totalDDIRecords: data.stats?.totalDDIRecords,
      totalDFIRecords: data.stats?.totalDFIRecords,
      totalDDSIRecords: data.stats?.totalDDSIRecords,
      totalDuplicationRecords: data.stats?.totalDuplicationRecords,
    });
  } catch (err) {
    console.error('1. /api/health error:', err.message);
  }

  // 2. Catalog endpoint
  try {
    const res = await fetch('http://localhost:3001/api/ddinter/catalog?limit=5');
    const data = await res.json();
    console.log('2. /api/ddinter/catalog:', {
      source: data.source,
      total: data.total,
      drugsReturned: data.drugs?.length
    });
  } catch (err) {
    console.error('2. /api/ddinter/catalog error:', err.message);
  }

  // 3. Check cleaned drugs for purity (no 'adalah', accurate identity)
  const testIds = ['DDInter1', 'DDInter2', 'DDInter4', 'DDInter14', 'DDInter60', 'DDInter500', 'DDInter1000', 'DDInter1500', 'DDInter2000'];
  for (const id of testIds) {
    try {
      const res = await fetch(`http://localhost:3001/api/drugs/${id}?nocache=true`);
      const d = await res.json();
      const hasIndo = (d.description || '').includes('adalah') || (d.pharmacology?.mechanismOfAction || '').includes('adalah');
      console.log(`3. Drug [${id}] ${d.name}:`, {
        formula: d.molecularFormula,
        dbId: d.drugBankId,
        pubchemCid: d.pubchemCid,
        hasSvg: !!d.structureSvg,
        hasIndo,
        descSnippet: (d.description || '').slice(0, 80)
      });
      if (hasIndo) {
        console.error(`FAIL: Found Indonesian synthetic text in ${id}!`);
      }
    } catch (err) {
      console.error(`3. Drug [${id}] error:`, err.message);
    }
  }

  // 4. Test Multi-Interaction Check
  try {
    const res = await fetch('http://localhost:3001/api/interactions/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drugIds: ['DDInter1', 'DDInter1263'], // Abacavir + Naltrexone (Moderate in DDInter 2.0)
        diseaseIds: ['Liver Diseases']
      })
    });
    const result = await res.json();
    console.log('4. /api/interactions/check result:', {
      drugsCount: result.analyzedDrugs?.length,
      ddiCount: result.drugInteractions?.length,
      ddsiCount: result.diseaseInteractions?.length,
      sampleDDI: result.drugInteractions?.[0] ? {
        pair: `${result.drugInteractions[0].drugA?.name} ⟷ ${result.drugInteractions[0].drugB?.name}`,
        severity: result.drugInteractions[0].severity,
        source: result.drugInteractions[0].source
      } : 'None'
    });
  } catch (err) {
    console.error('4. /api/interactions/check error:', err.message);
  }
}

checkApi();
