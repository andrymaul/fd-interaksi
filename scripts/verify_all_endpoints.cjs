async function run() {
  console.log('--- Checking API Endpoints on http://localhost:3001 ---');

  // 1. Stats
  const stats = await fetch('http://localhost:3001/api/stats').then(r => r.json());
  console.log('Stats:', {
    totalApprovedDrugs: stats.totalApprovedDrugs,
    totalDDIRecords: stats.totalDDIRecords,
    totalDFIRecords: stats.totalDFIRecords,
    totalDDSIRecords: stats.totalDDSIRecords,
    totalDuplicationRecords: stats.totalDuplicationRecords
  });

  // 2. Table DDI
  const ddiTable = await fetch('http://localhost:3001/api/ddinter/table?type=ddi&page=1&limit=5').then(r => r.json());
  console.log('DDI Table:', { total: ddiTable.total, rowsReturned: ddiTable.data?.length });

  // 3. Table DFI
  const dfiTable = await fetch('http://localhost:3001/api/ddinter/table?type=dfi&page=1&limit=5').then(r => r.json());
  console.log('DFI Table:', { total: dfiTable.total, rowsReturned: dfiTable.data?.length });

  // 4. Table DDSI
  const ddsiTable = await fetch('http://localhost:3001/api/ddinter/table?type=ddsi&page=1&limit=5').then(r => r.json());
  console.log('DDSI Table:', { total: ddsiTable.total, rowsReturned: ddsiTable.data?.length });

  // 5. Table Dupli
  const dupliTable = await fetch('http://localhost:3001/api/ddinter/table?type=dupli&page=1&limit=5').then(r => r.json());
  console.log('Duplication Table:', { total: dupliTable.total, rowsReturned: dupliTable.data?.length });

  // 6. Check DDI between Acamprosate and Pantoprazole
  const check = await fetch('http://localhost:3001/api/check-interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ drugs: ['Acamprosate', 'Pantoprazole'] })
  }).then(r => r.json());
  console.log('Check Interactions Result:', {
    interactionsFound: check.interactions?.length,
    pairs: check.interactions?.map(i => `${i.drugA} + ${i.drugB} (${i.severity})`)
  });

  // 7. Verify Acamprosate (DDInter10)
  const d10 = await fetch('http://localhost:3001/api/drugs/DDInter10').then(r => r.json());
  console.log('DDInter10 Details:', {
    id: d10.ddinterId,
    name: d10.name,
    pubchemCid: d10.pubchemCid,
    drugBankId: d10.drugBankId,
    ddiCount: d10.ddinterCounts?.ddi,
    liveInteractionsCount: d10.liveInteractions?.length
  });
}

run().catch(console.error);
